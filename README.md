# Multiplayer Agent Chat

A v0 walking skeleton for a **multi-user collaborative agent**: several people share one live chat session, debate a decision together, and an AI agent listens silently, answers when addressed, and — once the group actually converges — chimes in on its own with a synthesized result.

The demo domain is a group planning a Christmas trip to Japan, aligning on **dates, budget, top-3 places, and airline**. The architecture is domain-agnostic; only `src/domain/japan-trip.ts` is Japan-trip-specific.

Full design rationale lives in [`docs/superpowers/specs/2026-07-04-multiplayer-agent-chat-v0-design.md`](docs/superpowers/specs/2026-07-04-multiplayer-agent-chat-v0-design.md), and the original frozen module contract (the architecture this was scoped against) is in [`docs/reference/multiuser-agent-module-contracts.md`](docs/reference/multiuser-agent-module-contracts.md).

## Quick start

```bash
npm install
cp .env.example .env   # then put a real ANTHROPIC_API_KEY in .env
npm run dev             # starts ephemeral Temporal + worker + gateway, one process
npm run dev --workspace client   # in a second terminal — the React app
```

Open `http://localhost:5173` in 2-3 browser tabs, join the same session code with different display names, and start chatting.

`npm test` runs the full suite (50 tests). `npm run typecheck` checks the server; `npx tsc --noEmit -p client/tsconfig.json` checks the client.

## Architecture at a glance

```
React client (N browser tabs)
        │ WebSocket
        ▼
┌───────────────────────────────────────────┐
│ Node process (single instance)             │
│  Gateway → Session workflow (Temporal)     │
│              → pure core (routing,         │
│                projections, alignment)     │
│              → activities (Claude-backed   │
│                classifier, normalizer,     │
│                agent invocation)           │
└───────────────────────────────────────────┘
        │ Temporal SDK        │ Claude API
        ▼                     ▼
  Ephemeral Temporal    Anthropic API
  server (auto-spawned)
```

Everything except the ephemeral Temporal server and the Claude API runs in one process — no docker-compose, no Postgres, no Redis, no separate Python service. Those are all deliberate v0 simplifications; see "Design decisions" below for what each one traded away.

## Critical components

| Component | Where | Why it matters |
|---|---|---|
| **Pure core** | `src/core/` | Routing rules, projections, comparators, and alignment/facilitation logic — zero I/O, fully unit-tested (29 tests), safe to run inside a Temporal workflow sandbox. This is the part that decides *whether* the agent should speak and *whether the group has actually agreed on something* — get this wrong and everything downstream is noise. |
| **Session workflow** | `src/workflows/session.workflow.ts` | The single serialized writer. Holds the event log as workflow-local state, folds every message through routing → observation-recording → reactive agent → alignment detection → proactive agent, in that fixed order. This ordering (§9 of the design spec) is a contract, not an implementation detail — it's what lets the facilitation gate know whether the reactive agent already spoke this turn. |
| **Classifier + normalizer** | `src/activities/classifier.ts`, `src/activities/normalizer.ts` | The seam between raw chat text and structured decision state. The classifier extracts what was said (with conversation history, so it can resolve affirmations like "great" against an earlier proposal); the normalizer maps that onto the four decision dimensions. This pair is the most failure-prone part of the whole system — see "Hardest parts" below. |
| **Objective-model projection** | `src/core/projections/objective-model.ts` | A `dimension × participant` matrix with last-write-wins per cell. `reconcileAllDimensions` is what turns raw positions into `aligned` / `conflict` / `open`, and it's a pure structural comparison — no model call needed once positions are recorded. |
| **Alignment sidebar** | `client/src/AlignmentSidebar.tsx` | The user-facing proof that alignment is actually being tracked. Went through two real bugs (frozen at join time, raw epoch-ms display) before it correctly reflected live state — see below. |
| **Dev bootstrap** | `src/scripts/dev.ts` | `npm run dev` spins up an ephemeral in-memory Temporal server, the worker, and the WebSocket gateway as one command. No docker-compose. |

## Design decisions and where they deviate from the frozen contract

The [original contract](docs/reference/multiuser-agent-module-contracts.md) specifies Postgres, Redis, a Temporal Cloud/dev-server, and a standalone Python normalizer. This v0 skeleton deliberately deviates from all four, documented in full in the [design spec §8](docs/superpowers/specs/2026-07-04-multiplayer-agent-chat-v0-design.md#8-architecture-and-deviations-from-the-frozen-contract):

- **Event store → workflow-local state**, not Postgres. Temporal's own durable execution history already gives replay/recovery for free at this scale.
- **Pub/sub → in-process broadcast**, not Redis. Gateway and worker are co-located in one process; no cross-instance fan-out needed yet.
- **Temporal server → `@temporalio/testing`'s ephemeral local server**, auto-spawned by `dev.ts`. Ephemeral by design — a backend restart wipes all session state, which is why `npm run dev` prints a fresh "Ready" banner each time and every prior conversation is gone.
- **Normalizer → TypeScript, not Python.** v0's normalizer is an LLM prompt, not a real embeddings/NLP pipeline, so Python's ecosystem advantage isn't exercised yet. Revisit when a real NLP pipeline is actually needed.

One more deviation made *during* implementation, beyond the original four: the reactive agent was originally spec'd to read only the current message + signals, never the objective-model projection (an explicit invariant in the frozen contract). In practice this meant the agent couldn't answer "are we aligned on dates?" when asked directly. It now also receives a read-only summary of current alignment status — it still doesn't affect *whether* the agent gets invoked, only what it's able to say once invoked.

## Hardest parts (and what we learned building this)

The hard part of this system was never the plumbing — Temporal, WebSockets, React state, all came together in one implementation pass with only routine bugs. **The hard part is that the classifier/normalizer pipeline is a probabilistic component sitting inside an otherwise deterministic pipeline**, and several real bugs only showed up once real conversations were replayed against the live system:

1. **Classifiers need conversation history, or affirmations are unrecoverable.** The first version classified each message in complete isolation. A bare "great" or "works for me" produced *nothing* to record — there was no way to know what was being agreed to. Fixed by feeding the last 12 messages into the classifier prompt, with an explicit instruction to fully qualify affirmations (fill in an omitted month from earlier context, not copy the bare fragment).

2. **Never ask an LLM to do exact arithmetic.** The normalizer originally asked the model to directly emit epoch-millisecond integers. An unambiguous "Dec 20th to Dec 28th" got recorded as June 2025 — the model was hallucinating plausible-looking numbers instead of doing correct date math. Fixed by having the model emit plain ISO date strings and letting deterministic code (`Date.UTC`) do the conversion. This class of bug (LLM does arithmetic → wrong answer that *looks* plausible) is worth remembering for any future prompt that asks a model to compute rather than extract.

3. **Tone classification and content extraction are different concerns — don't conflate them.** `applyObservations` was gated on `actionability.kind !== 'social'`. A short, casually-toned affirmation ("me too, works fine") was sometimes classified as `social` by tone even when the *same* classifier call correctly extracted a real position from it — and the workflow discarded that position purely because of the tone label. The fix: gate on whether anything was actually extracted, not on how the message read.

4. **LLM output has genuine sampling variance, and there's no dial for it here.** `claude-sonnet-5` rejects an explicit `temperature` parameter outright (400, "deprecated for this model") — that lever isn't available. The same classifier call, given the identical message and history, occasionally reconstructs a multi-item value (the 3-place list) incompletely (e.g. `["Tokyo"]` instead of the full list) when resolving an affirmation that references something several turns back. This is **the one known-unreliable edge case remaining**: single-value dimensions (dates, airline) resolve reliably; a bare affirmation reconstructing a *list* from several turns back sometimes doesn't. Workaround: restate the full list explicitly rather than a bare "yes" — last-write-wins means one clear follow-up message fixes it immediately.

5. **A derived/computed field frozen at initial load is a very easy bug to ship.** The client only ever appended new chat messages to local state on each WebSocket `events` message — `objectiveModel`, `presence`, and `dimensionStatus` were captured once at the initial hydrate and never refreshed. The backend had been computing alignment correctly the entire time (confirmed by querying the live workflow directly); the sidebar just silently never re-rendered it. Any time a UI holds "the current state" derived from an initial snapshot plus a stream of deltas, double-check that *every* derived field gets refreshed on each delta, not just the append-only ones.

6. **`JSON.stringify` silently drops `Map` contents.** Both Temporal's own payload converter and the gateway's WebSocket forwarding serialize via JSON. `Map` objects serialize to `{}` — no error, just silently empty. Any Map-based projection state has to be explicitly converted to a plain object (`Object.fromEntries`) at the point it crosses a serialization boundary.

7. **UUIDs are not a UI.** Twice — once in the alignment sidebar, once in the chat pane — a component displayed a raw `participantId` because it never looked the ID up against the presence map. Same root cause both times: display code has to resolve identity through `presence.participants`, never show the ID directly.

None of the above were caught by unit tests (they're all mocked-Claude-client tests by design — see "Testing" below) — they only surfaced by replaying real multi-participant conversations against the live server and reading the actual recorded state. That's a deliberate limitation of testing an LLM-in-the-loop system this way, not an oversight: the mocked tests prove the deterministic plumbing is correct; only a live run with a real model proves the prompts actually work.

## Testing

- **`src/core/`** — plain unit tests against pure functions (comparators, routing rules, `AlignmentDetector`, `FacilitationGate`). No mocks needed; it's pure.
- **`src/activities/`** — unit tests with a fake Anthropic client (`AnthropicLike`), asserting on prompt construction and response parsing. These do not catch prompt *quality* issues — see "Hardest parts" above.
- **`src/workflows/session.workflow.test.ts`** — integration test via `@temporalio/testing`'s `TestWorkflowEnvironment`, with activities mocked to fixed responses.
- **Manual verification** — [`docs/superpowers/plans/2026-07-04-manual-verification-checklist.md`](docs/superpowers/plans/2026-07-04-manual-verification-checklist.md) tracks what's been verified against the live server with a real model versus what still needs a human pass.

## Repo layout

```
/src
  /core          # pure — routing, projections, comparators, facilitation
  /domain        # japan-trip.ts: the only domain-specific file
  /activities    # Claude-backed: classifier, normalizer, agent-invocation, broadcast
  /workflows     # session.workflow.ts — the single writer
  /gateway       # WebSocket server, wired to the Temporal client
  /scripts       # dev.ts — single-command bootstrap
/client          # React app (separate npm workspace)
/docs
  /reference     # the original frozen module contract
  /superpowers
    /specs       # the v0 design spec
    /plans       # the implementation plan + manual verification checklist
```
