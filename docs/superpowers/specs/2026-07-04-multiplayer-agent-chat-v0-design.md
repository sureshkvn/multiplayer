# Multiplayer Agent Chat — v0 Walking Skeleton Design

**Status:** approved for implementation planning.
**Builds on:** [`docs/reference/multiuser-agent-module-contracts.md`](../reference/multiuser-agent-module-contracts.md) (frozen module contract). This spec scopes a v0 "walking skeleton" on top of that contract and **explicitly documents every deviation** from it — see §8.

---

## 1. Goal

Demonstrate the multiplayer collaborative agent end to end: 2-3 participants, in separate browser tabs, share one live chat session; they debate a Christmas trip to Japan (dates, budget, top-3 places, airline); the agent listens silently, answers when addressed, and — once the group actually aligns on all four decisions — proactively posts a finalized itinerary (or pushes back if the aligned choice isn't feasible against a small mock dataset).

This is a proof of the **architecture**, not a production app: single instance, in-memory, no auth, one hardcoded domain.

## 2. Scope

**In scope:**
- One Temporal-backed session workflow per chat session; single-writer event log held in workflow-local state
- Full reactive routing (`RoutingPolicy` + rule chain)
- Full proactive path: `ObjectiveModelState` projection → `AlignmentDetector` → `FacilitationGate`
- Real Claude-backed `Classifier` and `Normalizer` (both TypeScript, both LLM calls — see §8 for why Normalizer isn't Python here)
- Synchronous agent invocation only — both reactive and facilitation triggers run as plain Temporal activities, no child workflows
- 2-3 browser tabs joining one session via display name + session code
- Chat thread + live alignment sidebar in the React client
- A static mock "knowledge base" the agent uses to validate feasibility and produce the finalized itinerary

**Explicitly out of scope (per the frozen contract's §10, unchanged):** shared artifacts/CRDT, permission/visibility model, stale-result rejection (`expectedVersion` is captured, not enforced).

**Additional v0-only deferrals:** real user accounts/auth, persistence across process restarts, horizontal scaling of the gateway, long-running child-workflow agents, multi-domain `DimensionSpec` registries (only travel/Japan exists).

## 3. Domain model

Four dimensions (dates and duration are collapsed into one range dimension; duration is derived from the agreed date range's length):

| Dimension | Type | Comparator | Alignment rule |
|---|---|---|---|
| `dates` | range (start, end) | range-overlap | aligned when all participants' date ranges overlap; agreed value = the intersection |
| `budget` | range (per-person cap) | range-overlap | aligned when all participants' budget ranges overlap; agreed value = the intersection |
| `places` | set of exactly 3 strings | set-equality (new comparator kind, not in the base contract) | aligned only when all participants name the exact same 3 places (order-independent) |
| `airline` | categorical | categorical | aligned when all participants hold the same value (existing `insist`-conflict semantics apply) |

`minCoverage` for all four dimensions = number of currently-present participants (**`requireAllEngaged`**, not `presentOnly`) — appropriate for a small, fixed group of 3 where a briefly-AFK participant shouldn't be silently overridden.

**Default routing/facilitation config** (tunable, no code changes needed to adjust):
- `addressedThreshold` = 0.6, `actionThreshold` = 0.6
- `invokeOnGroupQuestion` = true
- Facilitation debounce (`cooldownMs`) = 30000ms per trigger kind

## 4. Session mechanics

**Joining:** a user enters a display name and a session code. If the code is new, the gateway starts a Temporal workflow with `workflowId = sessionId`. If it exists, the client attaches a WebSocket and the gateway issues a Temporal **Query** for full current state (event log + projections) to hydrate the tab, then subscribes it to live deltas. A refreshed tab uses the same path — there is no separate "catch-up" mechanism, hydration-on-attach covers it.

**One shared workflow, N tabs:** every tab's WebSocket points at the same `sessionId`. A message typed in any tab → gateway → Temporal **Signal** into that workflow → `handleMessage` (per the contract's §9 fixed sequence) runs → resulting events are broadcast in-process to every socket subscribed to that session.

**Presence:** tracked as a thin projection (who has an open socket right now); feeds `requireAllEngaged` coverage checks and the UI's presence list.

## 5. Agent invocation

Both invocation paths are synchronous Temporal **activities** — no child workflows for v0:

- **Reactive** — `RoutingPolicy` fires on direct address/command/question per the default rule order (human-to-human → social → deliberation → direct-request → group-command → group-question). The activity calls Claude with the message + signals.
- **Proactive** — after each fold, `AlignmentDetector` re-evaluates the objective-model projection. Once all 4 dimensions read `aligned` for every present participant, `FacilitationGate` admits an `alignment-reached` trigger. The activity calls Claude with the aligned values plus the mock knowledge base to either finalize or push back (see §6).

## 6. Mock knowledge base & validation

A small static dataset bundled with the agent-invocation activity (no external API beyond Claude):
- A handful of Japan destinations: name, region, one-line blurb, a rough cost tier
- 2-3 airlines with mock routes/prices that vary by date range
- A feasibility rule: `estimated_cost(places, airline, dates) <= budget.max`, computed from the static data (a lookup/sum, not a real pricing engine)

**On `alignment-reached`:**
- **Feasible** → agent posts a finalized itinerary: dates, duration, budget, the 3 places with blurbs, airline with mock price. Emits `DecisionRatified`.
- **Infeasible** → agent posts a pushback message naming the specific shortfall (e.g. cost vs. budget gap) and does **not** emit `DecisionRatified`. Participants keep negotiating; changing any position naturally un-aligns that dimension, so the detector won't re-fire until the group converges again (the 30s debounce additionally guards against duplicate triggers within an unchanged aligned state).

## 7. Client (React)

- **Chat pane:** standard thread — name, message, timestamp; agent messages visually distinguished.
- **Alignment sidebar:** the 4 dimensions as rows, one column per present participant showing their current position + strength (`lean`/`prefer`/`insist`), and a per-row `aligned` / `conflict` / `open` badge from the `Reconciliation` status.
- **Presence:** avatar/name list of currently-connected participants.

## 8. Architecture, and deviations from the frozen contract

The module topology, interfaces, pure-core/activity partition, and the two invocation entry points are **unchanged** from the contract. Four infrastructure choices are deliberately simplified for v0 and documented here so they're easy to reverse later:

| Contract says | v0 does instead | Why | Revisit when |
|---|---|---|---|
| Postgres event store | In-memory `SessionEvent[]` inside workflow-local state | Temporal's own durable execution history already gives replay/recovery for free at this scale; a separate DB adds nothing yet | Event log needs to be queried/audited outside the workflow, or needs to survive a full Temporal data wipe |
| Redis pub/sub fan-out | In-process `Map<sessionId, Set<WebSocket>>` broadcast, gateway and worker co-located in one process | No need for cross-instance fan-out at 1 instance / demo scale | Gateway needs to scale horizontally (multiple instances) |
| Temporal server (managed/dev-server) | `@temporalio/testing`'s ephemeral local server, auto-spawned by the app's own bootstrap script (in-memory SQLite, torn down on exit) | This is Temporal's documented testing/dev facility, not a production deployment target — but it's the right fit for a local walking skeleton and matches the "OK to lose data on restart" call | Needs to run as a long-lived / shared / multi-user deployment |
| Python normalizer activity (§4, §11 of the contract) | TypeScript, same process, same Claude-backed approach as the classifier | v0's normalizer is an LLM prompt against a fixed `DimensionSpec` registry — none of Python's NLP/embedding-ecosystem rationale is exercised yet, so the process split has cost with no current benefit | A real embeddings/NLP pipeline is needed, or a second domain's normalizer needs independent redeploy cadence |

**Resulting process topology:** one command (`npm run dev`) starts three child processes — the ephemeral Temporal server, and (in the same Node process) the gateway + session workflow + all activities (classifier, normalizer, agent invocation). No docker-compose, no separate Postgres/Redis containers, no Python environment.

```
React client (browser, N tabs)
        │ WebSocket
        ▼
┌─────────────────────────────────────────────┐
│ Node app (single TypeScript process)         │
│  ┌───────────────┐                           │
│  │ Gateway        │  WebSocket + Temporal    │
│  │                │  client                  │
│  └──────┬────────┘                           │
│         ▼                                    │
│  ┌───────────────┐                           │
│  │ Session        │  core: routing,          │
│  │ workflow        │  projections, alignment │
│  └──────┬────────┘                           │
│         ▼                                    │
│  ┌───────────────┐                           │
│  │ Activities     │  classifier + normalizer │
│  │                │  + agent invocation       │
│  └──────┬────────┘                           │
└─────────┼─────────────────────────────────────┘
          │ Temporal SDK              │ LLM calls
          ▼                           ▼
  Temporal server (ephemeral,   Claude API (external)
  auto-spawned child process)
```

## 9. Repo layout

```
/core                      # pure, no I/O imports — unchanged from the contract
  /routing
  /events
  /projections
  /comparators             # includes the new set-equality comparator for `places`
  /facilitation
/activities
  classifier.ts            # TS, Claude-backed
  normalizer.ts             # TS, Claude-backed (v0 deviation — see §8)
  classifier-pipeline.ts
  agent-invocation.ts       # reactive + proactive, mock KB + validation
  broadcast.ts              # in-process WS push (v0 deviation — see §8)
/workflows
  session.workflow.ts       # event log lives as workflow-local state (v0 deviation — see §8)
/contracts                 # shared TS types — §3 vocabulary, ObservationPayload, etc.
/gateway                   # WebSocket server + Temporal client, same process as the worker
/client                    # React; chat + alignment sidebar
/scripts
  dev.ts                    # bootstraps: ephemeral Temporal server → worker/gateway process
docs/
  superpowers/specs/        # this file
  reference/                # the frozen module-contracts doc
```

## 10. Testing strategy

- **`/core`** — plain unit tests (Vitest) against pure functions: routing rules, all comparators (including set-equality), `AlignmentDetector`, `FacilitationGate`. No Temporal, no mocks — it's pure.
- **`/activities`** — unit tests with the Claude client mocked/stubbed to fixed responses; verify prompt construction and response parsing for classifier, normalizer, and the mock-KB validation logic.
- **Workflow integration** — Temporal's `TestWorkflowEnvironment` to run `handleMessage` end-to-end with mocked activities, verifying the fixed sequence in the contract's §9.
- **Manual demo verification** — 3 browser tabs, a scripted conversation converging on the 4 dimensions, confirm the agent's finalized-itinerary or pushback message appears in all tabs and the sidebar updates live; confirm `npm run dev` is the only command needed.

## 11. Success criteria

- `npm run dev` (no other setup beyond `npm install`) brings up a working session server.
- 3 browser tabs can join the same session code and see each other's messages live.
- Addressing the agent directly gets a reactive response.
- Converging all 3 participants on dates, budget, places, and airline triggers an unprompted, correct finalized itinerary or a specific, correct pushback — without any tab explicitly asking the agent to finalize.
- The alignment sidebar reflects per-dimension state accurately as the conversation progresses.
