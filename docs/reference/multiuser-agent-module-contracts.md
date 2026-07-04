all# Multi-User Collaborative Agent — Module Contracts (Handoff)

**Status:** frozen contract for scaffolding. Implementations behind these interfaces may change freely; the **interfaces**, the **pure-core / activity partition**, and the **two invocation entry points** must not change without a contract revision. Scaffold against these signatures, not against inferred ones.

**Stack:** TypeScript for the workflow core and activities; **Python for the standalone normalizer/data-processing activity** (chosen — see §4, §11); TypeScript + React for the client. Temporal is the durable-execution backbone.

---

## 1. Architectural invariants

These are the load-bearing rules. Everything else is refinement.

1. **Single serialized writer.** Exactly one component appends to the log and assigns `seq`: the session workflow. Linearizability within a session comes for free from this.
2. **Determinism boundary = process boundary.** Pure, deterministic logic runs *inside* the workflow (re-executed on replay). Anything non-deterministic (LLM calls, external I/O) is an **activity** the workflow awaits. This single rule decides where every module lives.
3. **Event-sourced state.** State is a fold over the ordered event log. Every projection is a *pure reducer*. Recovery = re-fold. No snapshot machinery until the log length demands it.
4. **Two invocation entry points, never one.**
   - *Reactive*: forks off `RoutingPolicy.decide`, reads **message + signals** only. Does not read projections.
   - *Proactive*: descends from `FacilitationGate`, reads a `FacilitationTrigger` derived from the **freshly-folded objective projection**.
   - `fold` is the conditional junction between them, not a third path.
5. **Bias to silence.** The agent speaks only on affirmative positive evidence. The terminal routing default is "do not respond."
6. **The `ObservationPayload` seam is frozen.** The classifier emits domain-agnostic `RawObservation`; a **standalone Python normalizer activity** maps it to `ObservationPayload`. Everything downstream of the normalizer consumes `ObservationPayload` only. The classifier never sees a `DimensionSpec` and the core never sees pre-normalized text, so either side can be re-tuned or re-deployed independently.

---

## 2. Module topology & physical placement

| Module | Layer | Language | Pattern |
|---|---|---|---|
| Client (chat UI, delta subscription) | client | TS / React | — |
| Gateway (auth, message → workflow signal) | edge service | TS | stateless |
| Session workflow (writer, orchestration) | **pure core** | TS | event-sourcing / CQRS |
| `RoutingPolicy` + rule chain | **pure core** | TS | Strategy + Chain of Responsibility |
| `toObservationEvents` | **pure core** | TS | pure mapper |
| Projections / `ProjectionRegistry` | **pure core** | TS | reducer |
| `AlignmentDetector` | **pure core** | TS | pure evaluator |
| `FacilitationGate` | **pure core** | TS | Strategy |
| `PositionComparator` set | **pure core** | TS | Strategy |
| Classifier (emits `RawObservation`) | **activity** | TS | — |
| Normalizer (`RawObservation` → `ObservationPayload`) | **activity** | **Python** | Strategy |
| Agent invocation (reactive) | **activity** | TS | — |
| Agent invocation (proactive / long-running) | **child workflow** | TS | — |
| Event store (append-only) | infra | Postgres | — |
| Pub/sub fan-out (per-session channel) | infra | Redis (or equiv.) | — |

Rule of thumb for future modules: **if it calls a model or the network, it is an activity; otherwise it belongs in the workflow core.**

---

## 3. Shared vocabulary

```typescript
interface IncomingMessage {
  id: string;
  sessionId: string;
  speakerId: string;
  speakerRole: 'human' | 'agent';
  text: string;
  ts: number;
  mentions: string[];        // resolved @-mentions, if the surface has them
  replyTo?: string;
}

interface Signal<T> {
  value: T;
  confidence: number;        // 0..1 — policies read this, not just value
  rationale?: string;        // retained for observability / tuning
}

// Provenance is a property of the data model. triggeredBy is recursive:
// "the pricing agent acted because human A asked".
type Actor =
  | { kind: 'human'; participantId: string }
  | { kind: 'agent'; agentId: string; triggeredBy: Actor }
  | { kind: 'system' };

interface SessionEvent<P = unknown> {
  seq: number;               // monotonic per session — THE serialization order
  sessionId: string;
  type: string;
  actor: Actor;
  payload: P;
  correlationId?: string;    // groups one utterance's / one agent task's chain
  ts: number;
}

// Writes are commands, not direct mutations (CQRS).
interface Command<P = unknown> {
  type: string;
  actor: Actor;
  payload: P;
  expectedVersion?: number;  // optimistic concurrency token (see §8, §10)
}
```

---

## 4. Classification + normalization (two activities → the frozen seam)

**Decision: Candidate B.** Two separate activities. The classifier stays domain-agnostic (never sees a `DimensionSpec`); a standalone **Python** normalizer maps its raw output onto the domain's decision dimensions. This keeps addressivity independent of domain modeling, lets a real NLP/embedding pipeline own normalization, and makes each side independently testable and re-deployable. Both are always-on and run on **every** message; both are cheap relative to the agent.

```typescript
type Addressee =
  | { kind: 'agent' }
  | { kind: 'human'; participantId: string }
  | { kind: 'group' }
  | { kind: 'none' };                         // ambient / social

type Actionability =
  | { kind: 'command'; intent: string }
  | { kind: 'question' }
  | { kind: 'deliberation' }                  // humans negotiating, not commanding
  | { kind: 'social' };                       // thanks, chatter

type Strength = 'lean' | 'prefer' | 'insist'; // ordinal — matters for reconciliation

// ── Classifier output: domain-AGNOSTIC. No dimension knowledge here. ──
interface RawObservation {
  participantId: string;
  text: string;                               // the preference/constraint as stated
  hint?: 'objective' | 'constraint' | 'proposal'; // coarse shape only, optional
}

interface ClassifierOutput {
  addressee: Signal<Addressee>;
  actionability: Signal<Actionability>;
  observations: Signal<RawObservation[]>;     // NOT yet normalized
}

// ── THE FROZEN SEAM ────────────────────────────────────────────────
// The normalizer's output. Everything downstream of the normalizer sees
// ONLY this — never RawObservation, never message text, never a DimensionSpec.
type ObservationPayload =
  | { scope: 'participant-objective'; participantId: string;
      dimensionId: string; value: unknown; strength: Strength }
  | { scope: 'constraint'; participantId: string; dimensionId: string; bound: unknown }
  | { scope: 'shared-proposal'; proposalId: string; summary: string };
// ───────────────────────────────────────────────────────────────────

// Post-normalization signals — the type the workflow core consumes.
interface MessageSignals {
  addressee: Signal<Addressee>;
  actionability: Signal<Actionability>;
  observations: Signal<ObservationPayload[]>; // normalized
}
```

The two activities and the pipeline that composes them:

```typescript
// Activity 1 — TypeScript. Reads the message, returns raw output.
interface Classifier {
  classify(msg: IncomingMessage, ctx: SessionContext): Promise<ClassifierOutput>;
}

// Activity 2 — Python. Injected with the DimensionSpec registry (§6).
// Strategy: pluggable normalization backend (rules / embeddings / model).
interface Normalizer {
  normalize(raw: RawObservation[], ctx: SessionContext): Promise<ObservationPayload[]>;
}

// Composes both activities; its output (normalized MessageSignals) is the
// boundary the workflow core sees. handleMessage (§9) calls only run().
interface ClassifierPipeline {
  run(msg: IncomingMessage, ctx: SessionContext): Promise<MessageSignals>;
  // internally: const c = await classifier.classify(...);
  //             const obs = await normalizer.normalize(c.observations.value, ctx);
  //             assemble MessageSignals { ...c, observations: { value: obs, ... } }
}
```

**Normalization contract.** The normalizer maps each `RawObservation.text` → `{ dimensionId, value, strength }` against the domain's `DimensionSpec` registry (§6). It must happen exactly once, at write time, so read-time conflict detection stays structural and the core stays pure.

- **Two round-trips per message** (classify, then normalize) is the accepted cost of the separation. If latency ever bites, issue the two activities against the same message in a single Temporal batch; do **not** collapse them back into one activity — that would re-couple domain modeling into the classifier.
- **The classifier must never import or receive a `DimensionSpec`.** Domain axes live only in the normalizer. Enforce by keeping `DimensionSpec` out of the classifier activity's dependency graph.
- **Cross-language type agreement:** `ObservationPayload`, `RawObservation`, `Strength`, and `DimensionSpec` are the TS↔Python contract surface. Generate the Python types from the `/contracts` package (§12) so the two languages cannot drift.
- **Do-not-do:** skipping normalization entirely. That does not remove work; it relocates conflict/alignment reasoning to *read time, on every detector cycle*, and forces the `AlignmentDetector` to become an activity (breaks the pure-core partition).

---

## 5. Routing (pure core)

Composition is a **Chain of Responsibility**: ordered rules, first match wins, silence as terminal default. Order encodes precedence. The firing rule *is* the explanation.

```typescript
interface RouteDecision {
  applyObservations: boolean;   // record what was heard (true except pure social)
  invokeAgent: boolean;         // the reactive proactivity dial
  label: 'act' | 'listen' | 'ignore';  // derived, telemetry only
  reason: string;               // "<ruleName>: <why>"
}

interface RoutingPolicyConfig {
  addressedThreshold: number;   // min confidence to treat agent/group as addressee
  actionThreshold: number;      // min confidence on command/question to act
  invokeOnGroupQuestion: boolean; // eager vs reticent — a proactivity dial
}

type InvokeVerdict = { invoke: boolean; reason: string };

interface RoutingRule {
  readonly name: string;
  // null = "does not apply, fall through to next rule"
  test(signals: MessageSignals, cfg: RoutingPolicyConfig, ctx: SessionContext): InvokeVerdict | null;
}

interface RoutingPolicy {
  decide(signals: MessageSignals, ctx: SessionContext): RouteDecision;
}
```

**Invariants the policy must enforce structurally (not per-rule):**
- `applyObservations = actionability.kind !== 'social'`, computed centrally. No rule can drop it.
- Terminal default is `{ invokeAgent: false, label: 'listen', reason: 'default-silence' }`.

**Default rule order (highest precedence first):** `human-to-human` → `social` → `deliberation` (the silent-listener rule; must precede command rules) → `direct-request` → `group-command` → `group-question` (gated by `invokeOnGroupQuestion`).

**Tuning surface (config only, no code):** `addressedThreshold`, `actionThreshold`, `invokeOnGroupQuestion`, and the rule order.

---

## 6. Event log + projections (pure core)

```typescript
interface Projection<S> {
  readonly name: string;
  initial(): S;
  apply(state: S, event: SessionEvent): S;   // pure, deterministic
  version(state: S): number;                 // seq of last mutating event
}

class ProjectionRegistry {
  constructor(projections: Projection<unknown>[]);
  apply(event: SessionEvent): void;          // fold one event across all projections
  get<S>(name: string): S;
  rebuild(log: Iterable<SessionEvent>): void; // replay / recovery
}
```

### Objective model — the projection that makes conflict detection cheap

Normalize at write, compare at read. The projection is a `dimension × participant` matrix. Conflict is only possible when two participants hold incompatible positions on the **same** dimension → detection is an `O(dimensions × participants)` structural walk, **no model call**.

```typescript
interface Position {
  participantId: string;
  value: unknown;                 // typed per dimension via its comparator
  strength: Strength;
  sourceSeq: number;              // provenance → the event that set it
  ts: number;
}

type Reconciliation =
  | { status: 'aligned'; value: unknown }
  | { status: 'conflict'; between: string[]; detail: string }
  | { status: 'open'; reason: 'insufficient-coverage' | 'unresolved' };

// Strategy: each dimension's semantics live in its comparator.
interface PositionComparator {
  readonly kind: string;          // 'categorical' | 'range' | ...
  reconcile(positions: Position[]): Reconciliation;
}

interface DimensionSpec {
  id: string;
  label: string;
  comparator: PositionComparator;
  decisionRelevant: boolean;      // gates "are we aligned enough to act"
  minCoverage: number;            // how many participants must weigh in
}

interface ObjectiveModelState {
  dimensions: Map<string, Map<string, Position>>; // dimId → (participantId → Position)
  ratified: Map<string, { value: unknown; seq: number }>;
  lastObservationSeq: number;
}
```

**Comparator notes:** last-write-wins **per participant per dimension** (changing your mind overwrites your own cell, provenance preserved). Comparators fold `Strength` — e.g. three `lean` + one `insist` on a categorical dimension resolves to aligned, not conflict. Only competing `insist`s are a real conflict.

### Other projections (all thin folds over the same log)

- **Canonical state** — the actual trip / repair-order / plan. `version()` returns the last mutating `seq`; this is the token checked against `Command.expectedVersion`.
- **Presence** — who is in the room now; input to whether an absent participant blocks alignment (`presentOnly` vs `requireAllEngaged`, see §7).
- **Catch-up** — "what happened while you were gone" digest for a returning participant, keyed on their `lastSeen` seq. Read this instead of scrollback.

### The write mapper

```typescript
// Pure: router signals → domain events. Writer supplies nextSeq (ordering stays
// the writer's job). correlationId = msg.id ties every position to its utterance.
function toObservationEvents(
  msg: IncomingMessage,
  signals: MessageSignals,
  nextSeq: () => number,
): SessionEvent[];
```

Event types emitted: `ObjectivePositionRecorded`, `ConstraintRecorded`, `ProposalRecorded`, plus `DecisionRatified` (from explicit ratification).

---

## 7. Alignment + facilitation (pure core)

Detection is pure (reports properties of accumulated state). Admission is a separate policy (decides whether to surface). They meet the same `FacilitationTrigger` contract.

```typescript
type FacilitationTrigger =
  | { kind: 'alignment-reached'; summary: string }
  | { kind: 'conflict-detected'; between: string[]; on: string }
  | { kind: 'stalled'; since: number };

interface AlignmentDetector {
  evaluate(ctx: SessionContext): FacilitationTrigger[];  // reads objective + presence
}

interface TurnContext {
  reactiveInvoked: boolean;             // did the agent already speak this turn?
  lastActionability: Actionability;
  recentFacilitations: { kind: string; at: number }[]; // for debounce
}

type FacilitationOutcome =
  | { action: 'surface' }               // speak as its own facilitator turn
  | { action: 'fold' }                  // merge into the already-firing reactive turn
  | { action: 'suppress'; reason: string };

interface FacilitationGate {
  admit(trigger: FacilitationTrigger, turn: TurnContext): FacilitationOutcome;
}
```

**Gate etiquette the default implementation must encode:**
- **Debounce:** suppress the same trigger kind within `cooldownMs`.
- **One utterance per human message:** if `reactiveInvoked`, return `fold` rather than double-posting.
- **No commentary mid-argument:** suppress `alignment-reached` / `conflict-detected` while `lastActionability.kind === 'deliberation'`. Surface conflict when the group is *stalled* on it, not while it's live.
- **`stalled` is the one trigger allowed to break the one-utterance rule** — it is timer-driven (a Temporal timer on a lull), flows through the gate with `reactiveInvoked: false`, and surfaces. Breaking a silence is the one unambiguously welcome proactive interruption.

**Alignment scope knob:** `presentOnly` (absent participants don't block; ratified decisions stand) vs `requireAllEngaged`. Fleet and travel may want opposite defaults.

---

## 8. Agent invocation (activity / child workflow)

Two entry points, different trigger sources, different context. **Never merge them.**

```typescript
interface AgentRequest {
  trigger: 'reactive' | 'facilitation';
  msg?: IncomingMessage;                // reactive
  signals?: MessageSignals;             // reactive
  facilitation?: FacilitationTrigger;   // proactive
  expectedVersion: number;              // captured at dispatch (see below)
}

interface AgentTask extends AgentRequest {
  // A reactive result exposes a hook so a folded facilitation can ride along:
  addFacilitationHint?(t: FacilitationTrigger): void;
}
```

- **Reactive** fires from `RoutingPolicy` when a rule returns `invoke: true`. Reads `msg` + `signals`. Runs as an **activity**; may run *before* the fold (it does not depend on projections).
- **Proactive** fires from `FacilitationGate` on `surface`. Reads the `FacilitationTrigger`. Long-running variants (pricing, diagnostics) run as **child workflows** so they survive participant disconnects.
- **`expectedVersion` capture:** at dispatch, read the canonical projection's `version()` and thread it onto the request → the result command. **Today it is recorded and ignored.** The only discipline required now is capturing it; enabling stale-rejection later (§10) is then a one-place change in the writer with no agent-code changes.

---

## 9. Orchestration — the workflow tick

The ordering below is a contract, not an implementation detail. It is what lets the gate know whether reactive already fired.

```typescript
async function handleMessage(msg: IncomingMessage, ctx: SessionContext, deps: Deps): Promise<void> {
  const signals  = await deps.pipeline.run(msg, ctx);   // activity
  const decision = deps.policy.decide(signals, ctx);    // pure — reactive path forks here

  if (decision.applyObservations)
    await deps.emit(toObservationEvents(msg, signals, deps.nextSeq));  // → fold

  const reactive = decision.invokeAgent
    ? await deps.invokeAgent({ trigger: 'reactive', msg, signals,
                               expectedVersion: deps.canonicalVersion() })
    : undefined;

  const turn: TurnContext = {
    reactiveInvoked: !!reactive,
    lastActionability: signals.actionability.value,
    recentFacilitations: ctx.recentFacilitations,
  };

  for (const trigger of deps.alignmentDetector.evaluate(ctx)) {  // reads folded projection
    const outcome = deps.facilitationGate.admit(trigger, turn);
    if (outcome.action === 'surface')
      await deps.invokeAgent({ trigger: 'facilitation', facilitation: trigger,
                               expectedVersion: deps.canonicalVersion() });
    else if (outcome.action === 'fold' && reactive)
      reactive.addFacilitationHint?.(trigger);
    // suppress → nothing
  }
}
```

**Fixed sequence:** classify → decide → record observations → fold → reactive agent (if any) → detector reads updated projection → gate (which knows whether reactive fired).

---

## 10. Explicitly deferred / out of scope

Do **not** build these now. Listed so scaffolding leaves clean seams.

- **Shared artifacts / CRDT.** No co-edited document surface. The single-writer event log is the only state model. (If added later, scope the CRDT to that artifact only; decisions stay in the event log.)
- **Permission / visibility model.** Memory scoping (private / shared-session / team) and leak-prevention are deferred. Keep `ObservationPayload.participantId` so scoping can be layered on later.
- **Stale-result rejection.** `expectedVersion` is captured but not checked. Enabling it later = in the writer, `if (cmd.expectedVersion !== canonical.version()) reject/re-dispatch`. One place, no agent changes.

---

## 11. Resolved decision — normalization placement

**Chosen: Candidate B — standalone Python normalizer activity.** The classifier (TypeScript) emits domain-agnostic `RawObservation`; a separate Python activity, injected with the `DimensionSpec` registry, produces `ObservationPayload`.

Rationale:
- **Separation of concerns.** Addressivity/actionability (does the agent act) is independent of domain modeling (which decision axis is this). Fusing them would couple two things that get tuned on different schedules.
- **Right tool per job.** Normalization is a data-processing / NLP task — Python with an embedding or classifier pipeline is the natural home; the classifier stays a lightweight TS call.
- **Multi-domain ready.** Travel and fleet swap only the normalizer + its `DimensionSpec` registry; the classifier and the entire core are untouched.
- **Testability.** Each activity is exercised in isolation against fixed inputs.

Accepted trade-off: two round-trips per message instead of one (see §4 for the batching mitigation). The `ObservationPayload` seam is unchanged by this choice — it was always the boundary; Candidate B simply puts a process/language boundary at the same seam.

---

## 12. Suggested directory layout

```
/core                      # pure, runs inside the workflow — no I/O imports allowed
  /routing
    policy.ts              # RuleBasedRoutingPolicy
    rules.ts               # default rule chain
    types.ts               # RouteDecision, RoutingRule, config
  /events
    types.ts               # SessionEvent, Command, Actor
    to-observation-events.ts
  /projections
    registry.ts            # ProjectionRegistry
    objective-model.ts     # projection + Position + ObjectiveModelState
    canonical.ts
    presence.ts
    catchup.ts
  /comparators             # PositionComparator strategies
    categorical.ts
    range.ts
  /facilitation
    detector.ts            # AlignmentDetector
    gate.ts                # FacilitationGate
    types.ts               # FacilitationTrigger, TurnContext, FacilitationOutcome
/activities                # non-deterministic — the only place I/O lives
  classifier.ts            # Classifier (TS) — emits RawObservation, NO DimensionSpec import
  classifier-pipeline.ts   # ClassifierPipeline — composes classify() then normalize()
  agent-invocation.ts
/normalizer                # standalone Python activity (Candidate B)
  worker.py                # Temporal Python activity worker
  normalize.py             # Normalizer impl (rules / embeddings / model backend)
  dimensions/              # DimensionSpec registry per domain (travel/, fleet/)
  pyproject.toml
/workflows
  session.workflow.ts      # the single writer + handleMessage orchestration
  agent.childworkflow.ts   # long-running proactive agents
/contracts                 # shared cross-language contract package (workspace package)
  ts/                      # source of truth: §3 types, RawObservation, ObservationPayload,
                           #   Strength, DimensionSpec, MessageSignals
  python/                  # GENERATED from ts/ — imported by /normalizer, never hand-edited
  codegen.*                # TS → Python type generation step, run in CI
/gateway                   # message → signal, stateless
/client                    # React; subscribes to per-session deltas
```

**Two lint/build rules that mechanically enforce the contract:**
1. Nothing under `/core` may import from `/activities`, `/normalizer`, `/workflows`, or any I/O library. That rule *is* the pure/activity partition.
2. `/activities/classifier.ts` may not import `DimensionSpec` (or anything from `/normalizer/dimensions`). That rule *is* the classifier's domain-agnosticism — it keeps the Candidate B separation from eroding over time.

The Python types under `/contracts/python` are generated from the TS source, so the classifier↔normalizer↔core boundary cannot drift across languages.
