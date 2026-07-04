# Multiplayer Agent Chat v0 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the v0 walking skeleton from `docs/superpowers/specs/2026-07-04-multiplayer-agent-chat-v0-design.md` — 2-3 browser tabs sharing one live Temporal-backed chat session, debating a Japan trip, with the agent responding reactively when addressed and proactively once the group aligns on dates/budget/places/airline.

**Architecture:** Pure core logic (routing, projections, comparators, alignment/facilitation) with zero I/O, consumed by Claude-backed activities and a single Temporal session workflow that holds the event log as workflow-local state. Everything — gateway, workflow, activities — runs in one Node/TypeScript process; only the ephemeral Temporal server (auto-spawned) and the Claude API are external.

**Tech Stack:** TypeScript (Node 20+), `@temporalio/worker` / `@temporalio/client` / `@temporalio/workflow` / `@temporalio/testing`, `@anthropic-ai/sdk`, `ws`, Vitest, React + Vite (client workspace).

## Global Constraints

- TypeScript everywhere — no Python (documented v0 deviation from the frozen contract's §11).
- Single Node process for gateway + workflow + core + activities (documented v0 deviation — no separate service processes besides the ephemeral Temporal server).
- Temporal via `@temporalio/testing`'s `TestWorkflowEnvironment.createLocal()` — ephemeral, in-memory, auto-spawned by `src/scripts/dev.ts`. No docker-compose, no Postgres, no Redis.
- All LLM calls use Claude, model id `claude-sonnet-5`.
- Event log lives as workflow-local state (a plain array); recovery relies on Temporal's own durable execution history, not an external DB.
- `requireAllEngaged`: alignment on a dimension requires a position from every currently-*present* (connected) participant, not just "some."
- Root `package.json` uses npm workspaces: `["client"]`. Server-side source lives under `/src` at the repo root, not in its own workspace package.
- Vitest for all unit/integration tests; colocate `*.test.ts` next to the source file it tests.
- v0 simplification (documented): the `stalled` facilitation trigger from the frozen contract is **not implemented** — it requires cancellable Temporal timers that add real complexity with no requirement driving it yet. Correspondingly, `conflict-detected` surfaces immediately (subject to the same debounce/mid-deliberation suppression as `alignment-reached`), rather than waiting for a stall. Revisit if a future spec needs "the agent notices you've gone quiet."

---

### Task 1: Project scaffold + range comparator

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `vitest.config.ts`
- Create: `src/core/comparators/types.ts`
- Create: `src/core/comparators/range.ts`
- Test: `src/core/comparators/range.test.ts`

**Interfaces:**
- Produces: `Position { participantId: string; value: unknown; strength: Strength; sourceSeq: number; ts: number }`, `Reconciliation` (union), `PositionComparator { readonly kind: string; reconcile(positions: Position[]): Reconciliation }`, `DimensionSpec { id, label, comparator, decisionRelevant, minCoverage }`, `Range { min: number; max: number }`, `rangeComparator: PositionComparator`

- [ ] **Step 1: Create `package.json`**

```json
{
  "name": "multiplayer-agent-chat",
  "private": true,
  "type": "module",
  "workspaces": ["client"],
  "scripts": {
    "dev": "tsx src/scripts/dev.ts",
    "test": "vitest run",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "@anthropic-ai/sdk": "^0.32.0",
    "@temporalio/client": "^1.11.0",
    "@temporalio/worker": "^1.11.0",
    "@temporalio/workflow": "^1.11.0",
    "@temporalio/testing": "^1.11.0",
    "ws": "^8.18.0"
  },
  "devDependencies": {
    "typescript": "^5.6.0",
    "tsx": "^4.19.0",
    "vitest": "^2.1.0",
    "@types/node": "^22.0.0",
    "@types/ws": "^8.5.0"
  }
}
```

- [ ] **Step 2: Create `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "outDir": "dist",
    "declaration": false
  },
  "include": ["src"],
  "exclude": ["client", "dist", "node_modules"]
}
```

- [ ] **Step 3: Create `vitest.config.ts`**

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
  },
});
```

- [ ] **Step 4: Run `npm install`**

Run: `npm install`
Expected: installs without errors, creates `package-lock.json` and `node_modules/`.

- [ ] **Step 5: Write the failing test for the range comparator**

```ts
// src/core/comparators/range.test.ts
import { describe, it, expect } from 'vitest';
import { rangeComparator } from './range.js';
import type { Position } from './types.js';

function pos(participantId: string, value: unknown, strength: Position['strength'] = 'lean'): Position {
  return { participantId, value, strength, sourceSeq: 1, ts: 1 };
}

describe('rangeComparator', () => {
  it('aligns on the intersection when ranges overlap', () => {
    const result = rangeComparator.reconcile([
      pos('alice', { min: 100, max: 200 }),
      pos('bob', { min: 150, max: 250 }),
    ]);
    expect(result).toEqual({ status: 'aligned', value: { min: 150, max: 200 } });
  });

  it('reports conflict when ranges do not overlap', () => {
    const result = rangeComparator.reconcile([
      pos('alice', { min: 100, max: 150 }),
      pos('bob', { min: 200, max: 250 }),
    ]);
    expect(result.status).toBe('conflict');
  });

  it('is open/unresolved with no positions', () => {
    expect(rangeComparator.reconcile([])).toEqual({ status: 'open', reason: 'unresolved' });
  });
});
```

- [ ] **Step 6: Run the test to verify it fails**

Run: `npx vitest run src/core/comparators/range.test.ts`
Expected: FAIL — `range.ts` does not exist yet.

- [ ] **Step 7: Create `src/core/comparators/types.ts`**

```ts
import type { Strength } from '../classification/types.js';

export interface Position {
  participantId: string;
  value: unknown;
  strength: Strength;
  sourceSeq: number;
  ts: number;
}

export type Reconciliation =
  | { status: 'aligned'; value: unknown }
  | { status: 'conflict'; between: string[]; detail: string }
  | { status: 'open'; reason: 'insufficient-coverage' | 'unresolved' };

export interface PositionComparator {
  readonly kind: string;
  reconcile(positions: Position[]): Reconciliation;
}

export interface DimensionSpec {
  id: string;
  label: string;
  comparator: PositionComparator;
  decisionRelevant: boolean;
  minCoverage: number;
}
```

Note: `Strength` is defined in Task 4's classification types file, but Task 1 needs it first. Create a minimal placeholder-free stub now — see Step 8.

- [ ] **Step 8: Create `src/core/classification/types.ts` (Strength only for now; extended in Task 11)**

```ts
export type Strength = 'lean' | 'prefer' | 'insist';
```

- [ ] **Step 9: Create `src/core/comparators/range.ts`**

```ts
import type { Position, Reconciliation, PositionComparator } from './types.js';

export interface Range {
  min: number;
  max: number;
}

export const rangeComparator: PositionComparator = {
  kind: 'range',
  reconcile(positions: Position[]): Reconciliation {
    if (positions.length === 0) return { status: 'open', reason: 'unresolved' };
    const ranges = positions.map((p) => p.value as Range);
    const intersectionMin = Math.max(...ranges.map((r) => r.min));
    const intersectionMax = Math.min(...ranges.map((r) => r.max));
    if (intersectionMin <= intersectionMax) {
      return { status: 'aligned', value: { min: intersectionMin, max: intersectionMax } };
    }
    return {
      status: 'conflict',
      between: positions.map((p) => p.participantId),
      detail: `No overlapping range across ${positions.length} positions`,
    };
  },
};
```

- [ ] **Step 10: Run the test to verify it passes**

Run: `npx vitest run src/core/comparators/range.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 11: Commit**

```bash
git add package.json tsconfig.json vitest.config.ts src/core/comparators/types.ts src/core/comparators/range.ts src/core/comparators/range.test.ts src/core/classification/types.ts package-lock.json
git commit -m "feat: project scaffold and range comparator"
```

---

### Task 2: Categorical comparator (with strength folding)

**Files:**
- Create: `src/core/comparators/categorical.ts`
- Test: `src/core/comparators/categorical.test.ts`

**Interfaces:**
- Consumes: `Position`, `Reconciliation`, `PositionComparator` from `./types.js` (Task 1)
- Produces: `categoricalComparator: PositionComparator`

- [ ] **Step 1: Write the failing test**

```ts
// src/core/comparators/categorical.test.ts
import { describe, it, expect } from 'vitest';
import { categoricalComparator } from './categorical.js';
import type { Position } from './types.js';

function pos(participantId: string, value: unknown, strength: Position['strength'] = 'lean'): Position {
  return { participantId, value, strength, sourceSeq: 1, ts: 1 };
}

describe('categoricalComparator', () => {
  it('aligns when everyone holds the same value', () => {
    const result = categoricalComparator.reconcile([pos('alice', 'ANA'), pos('bob', 'ANA')]);
    expect(result).toEqual({ status: 'aligned', value: 'ANA' });
  });

  it('resolves to the insisted value when others only lean', () => {
    const result = categoricalComparator.reconcile([
      pos('alice', 'ANA', 'lean'),
      pos('bob', 'ANA', 'lean'),
      pos('carol', 'JAL', 'insist'),
    ]);
    expect(result).toEqual({ status: 'aligned', value: 'JAL' });
  });

  it('conflicts when two different values are both insisted', () => {
    const result = categoricalComparator.reconcile([
      pos('alice', 'ANA', 'insist'),
      pos('bob', 'JAL', 'insist'),
    ]);
    expect(result.status).toBe('conflict');
  });

  it('is open/unresolved when values differ and nobody insists', () => {
    const result = categoricalComparator.reconcile([pos('alice', 'ANA', 'lean'), pos('bob', 'JAL', 'prefer')]);
    expect(result).toEqual({ status: 'open', reason: 'unresolved' });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/core/comparators/categorical.test.ts`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement `src/core/comparators/categorical.ts`**

```ts
import type { Position, Reconciliation, PositionComparator } from './types.js';

export const categoricalComparator: PositionComparator = {
  kind: 'categorical',
  reconcile(positions: Position[]): Reconciliation {
    if (positions.length === 0) return { status: 'open', reason: 'unresolved' };

    const distinctValues = new Set(positions.map((p) => p.value));
    if (distinctValues.size === 1) {
      return { status: 'aligned', value: positions[0].value };
    }

    const insisted = positions.filter((p) => p.strength === 'insist');
    const insistedValues = new Set(insisted.map((p) => p.value));

    if (insistedValues.size === 0) return { status: 'open', reason: 'unresolved' };
    if (insistedValues.size === 1) return { status: 'aligned', value: insisted[0].value };

    return {
      status: 'conflict',
      between: insisted.map((p) => p.participantId),
      detail: `Competing insist positions: ${[...insistedValues].join(', ')}`,
    };
  },
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/core/comparators/categorical.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add src/core/comparators/categorical.ts src/core/comparators/categorical.test.ts
git commit -m "feat: categorical comparator with strength folding"
```

---

### Task 3: Set-equality comparator (for `places`)

**Files:**
- Create: `src/core/comparators/set-equality.ts`
- Test: `src/core/comparators/set-equality.test.ts`

**Interfaces:**
- Consumes: `Position`, `Reconciliation`, `PositionComparator` from `./types.js` (Task 1)
- Produces: `setEqualityComparator: PositionComparator` (value type: `string[]`)

- [ ] **Step 1: Write the failing test**

```ts
// src/core/comparators/set-equality.test.ts
import { describe, it, expect } from 'vitest';
import { setEqualityComparator } from './set-equality.js';
import type { Position } from './types.js';

function pos(participantId: string, value: string[], strength: Position['strength'] = 'lean'): Position {
  return { participantId, value, strength, sourceSeq: 1, ts: 1 };
}

describe('setEqualityComparator', () => {
  it('aligns when everyone names the same 3 places, order-independent', () => {
    const result = setEqualityComparator.reconcile([
      pos('alice', ['Tokyo', 'Kyoto', 'Osaka']),
      pos('bob', ['Osaka', 'Tokyo', 'Kyoto']),
    ]);
    expect(result.status).toBe('aligned');
  });

  it('conflicts when two different sets are both insisted', () => {
    const result = setEqualityComparator.reconcile([
      pos('alice', ['Tokyo', 'Kyoto', 'Osaka'], 'insist'),
      pos('bob', ['Tokyo', 'Hokkaido', 'Okinawa'], 'insist'),
    ]);
    expect(result.status).toBe('conflict');
  });

  it('is open/unresolved when sets differ and nobody insists', () => {
    const result = setEqualityComparator.reconcile([
      pos('alice', ['Tokyo', 'Kyoto', 'Osaka']),
      pos('bob', ['Tokyo', 'Hokkaido', 'Okinawa']),
    ]);
    expect(result).toEqual({ status: 'open', reason: 'unresolved' });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/core/comparators/set-equality.test.ts`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement `src/core/comparators/set-equality.ts`**

```ts
import type { Position, Reconciliation, PositionComparator } from './types.js';

function setKey(values: string[]): string {
  return [...values].map((v) => v.trim().toLowerCase()).sort().join('|');
}

export const setEqualityComparator: PositionComparator = {
  kind: 'set-equality',
  reconcile(positions: Position[]): Reconciliation {
    if (positions.length === 0) return { status: 'open', reason: 'unresolved' };

    const keyed = positions.map((p) => ({ p, key: setKey(p.value as string[]) }));
    const distinctKeys = new Set(keyed.map((k) => k.key));
    if (distinctKeys.size === 1) return { status: 'aligned', value: positions[0].value };

    const insisted = keyed.filter((k) => k.p.strength === 'insist');
    const insistedKeys = new Set(insisted.map((k) => k.key));

    if (insistedKeys.size === 0) return { status: 'open', reason: 'unresolved' };
    if (insistedKeys.size === 1) return { status: 'aligned', value: insisted[0].p.value };

    return {
      status: 'conflict',
      between: insisted.map((k) => k.p.participantId),
      detail: 'Competing sets of 3 places',
    };
  },
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/core/comparators/set-equality.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add src/core/comparators/set-equality.ts src/core/comparators/set-equality.test.ts
git commit -m "feat: set-equality comparator for the places dimension"
```

---

### Task 4: Japan trip domain — DimensionSpec registry + mock knowledge base

**Files:**
- Create: `src/domain/japan-trip.ts`
- Test: `src/domain/japan-trip.test.ts`

**Interfaces:**
- Consumes: `Range` (Task 1), `rangeComparator` (Task 1), `categoricalComparator` (Task 2), `setEqualityComparator` (Task 3), `DimensionSpec` (Task 1)
- Produces: `DIMENSIONS: DimensionSpec[]` (ids: `dates`, `budget`, `places`, `airline`), `DESTINATIONS`, `AIRLINES`, `estimateTripCostPerPerson(places: string[], airlineName: string, dates: Range): number`

- [ ] **Step 1: Write the failing test**

```ts
// src/domain/japan-trip.test.ts
import { describe, it, expect } from 'vitest';
import { DIMENSIONS, estimateTripCostPerPerson } from './japan-trip.js';

describe('japan-trip domain', () => {
  it('defines exactly the 4 expected dimensions', () => {
    expect(DIMENSIONS.map((d) => d.id).sort()).toEqual(['airline', 'budget', 'dates', 'places']);
  });

  it('estimates a higher cost for peak Christmas dates', () => {
    const dec = { min: Date.UTC(2026, 11, 20), max: Date.UTC(2026, 11, 27) };
    const mar = { min: Date.UTC(2026, 2, 20), max: Date.UTC(2026, 2, 27) };
    const decCost = estimateTripCostPerPerson(['Tokyo', 'Kyoto', 'Osaka'], 'ANA', dec);
    const marCost = estimateTripCostPerPerson(['Tokyo', 'Kyoto', 'Osaka'], 'ANA', mar);
    expect(decCost).toBeGreaterThan(marCost);
  });

  it('throws on an unknown airline', () => {
    expect(() => estimateTripCostPerPerson(['Tokyo'], 'NotAnAirline', { min: 0, max: 86400000 })).toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/domain/japan-trip.test.ts`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement `src/domain/japan-trip.ts`**

```ts
import type { DimensionSpec } from '../core/comparators/types.js';
import { rangeComparator, type Range } from '../core/comparators/range.js';
import { categoricalComparator } from '../core/comparators/categorical.js';
import { setEqualityComparator } from '../core/comparators/set-equality.js';

export const DIMENSIONS: DimensionSpec[] = [
  { id: 'dates', label: 'Travel dates', comparator: rangeComparator, decisionRelevant: true, minCoverage: 1 },
  { id: 'budget', label: 'Per-person budget', comparator: rangeComparator, decisionRelevant: true, minCoverage: 1 },
  { id: 'places', label: 'Top 3 places', comparator: setEqualityComparator, decisionRelevant: true, minCoverage: 1 },
  { id: 'airline', label: 'Airline', comparator: categoricalComparator, decisionRelevant: true, minCoverage: 1 },
];
// Note: minCoverage here is a nominal floor. The real "requireAllEngaged" check
// compares engaged participantIds against the presence projection directly —
// see reconcileAllDimensions in src/core/projections/objective-model.ts (Task 5).

export interface DestinationInfo {
  name: string;
  region: string;
  blurb: string;
  costTier: 1 | 2 | 3;
}

export const DESTINATIONS: DestinationInfo[] = [
  { name: 'Tokyo', region: 'Kanto', blurb: 'Neon streets, world-class food, endless neighborhoods to explore.', costTier: 2 },
  { name: 'Kyoto', region: 'Kansai', blurb: 'Temples, gardens, and geisha districts steeped in history.', costTier: 2 },
  { name: 'Osaka', region: 'Kansai', blurb: 'Street food capital with a laid-back, lively energy.', costTier: 1 },
  { name: 'Hokkaido', region: 'Hokkaido', blurb: 'Snow festivals and powder skiing in the far north.', costTier: 3 },
  { name: 'Hiroshima', region: 'Chugoku', blurb: "Peace memorial and nearby Miyajima's floating torii gate.", costTier: 1 },
  { name: 'Okinawa', region: 'Okinawa', blurb: 'Subtropical beaches and a distinct island culture.', costTier: 2 },
];

export interface AirlineOption {
  name: string;
  basePricePerPerson: number;
  peakSurchargeMultiplier: number;
}

export const AIRLINES: AirlineOption[] = [
  { name: 'ANA', basePricePerPerson: 1400, peakSurchargeMultiplier: 1.3 },
  { name: 'JAL', basePricePerPerson: 1350, peakSurchargeMultiplier: 1.35 },
  { name: 'United', basePricePerPerson: 1100, peakSurchargeMultiplier: 1.5 },
];

const COST_TIER_PER_DAY: Record<1 | 2 | 3, number> = { 1: 80, 2: 120, 3: 180 };

function isChristmasPeak(dates: Range): boolean {
  const d = new Date(dates.min);
  return d.getUTCMonth() === 11 && d.getUTCDate() >= 15;
}

export function estimateTripCostPerPerson(places: string[], airlineName: string, dates: Range): number {
  const airline = AIRLINES.find((a) => a.name.toLowerCase() === airlineName.toLowerCase());
  if (!airline) throw new Error(`Unknown airline: ${airlineName}`);

  const durationDays = Math.max(1, Math.round((dates.max - dates.min) / 86_400_000) + 1);
  const flightCost = airline.basePricePerPerson * (isChristmasPeak(dates) ? airline.peakSurchargeMultiplier : 1);
  const avgDailyCost =
    places.reduce((sum, name) => {
      const dest = DESTINATIONS.find((d) => d.name.toLowerCase() === name.toLowerCase());
      return sum + COST_TIER_PER_DAY[dest?.costTier ?? 2];
    }, 0) / Math.max(1, places.length);

  return Math.round(flightCost + avgDailyCost * durationDays);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/domain/japan-trip.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add src/domain/japan-trip.ts src/domain/japan-trip.test.ts
git commit -m "feat: japan-trip domain dimensions and mock knowledge base"
```

---

### Task 5: Objective-model projection + cross-dimension reconciliation helper

**Files:**
- Create: `src/core/projections/types.ts`
- Create: `src/core/projections/objective-model.ts`
- Test: `src/core/projections/objective-model.test.ts`

**Interfaces:**
- Consumes: `Position`, `DimensionSpec` (Task 1), `Strength` (Task 1/Task 11), `SessionEvent` (Task 6 defines the full type, but only `{seq, type, payload, ts}` shape is used here — declared locally to avoid a forward dependency, then Task 6 supersedes the import)
- Produces: `Projection<S>` interface, `ObjectiveModelState`, `objectiveModelProjection: Projection<ObjectiveModelState>`, `reconcileAllDimensions(model: ObjectiveModelState, presentIds: string[], dimensions: DimensionSpec[]): Map<string, Reconciliation>`

Note on sequencing: this task needs a minimal `SessionEvent` shape before Task 6 formally owns that type. To avoid circular/forward dependencies, this task defines `Projection<S>` and consumes a **structural** event type (`{ seq: number; type: string; payload: unknown; ts: number }`) rather than importing from a not-yet-created events module. Task 6 will create the full `SessionEvent` type; TypeScript's structural typing means the eventual concrete type satisfies this shape without any change needed here.

- [ ] **Step 1: Write the failing test**

```ts
// src/core/projections/objective-model.test.ts
import { describe, it, expect } from 'vitest';
import { objectiveModelProjection, reconcileAllDimensions } from './objective-model.js';
import { DIMENSIONS } from '../../domain/japan-trip.js';

function positionEvent(seq: number, participantId: string, dimensionId: string, value: unknown, strength = 'lean') {
  return { seq, type: 'ObjectivePositionRecorded', payload: { participantId, dimensionId, value, strength }, ts: seq };
}

describe('objectiveModelProjection', () => {
  it('folds position events into the dimensions map', () => {
    let state = objectiveModelProjection.initial();
    state = objectiveModelProjection.apply(state, positionEvent(1, 'alice', 'airline', 'ANA'));
    state = objectiveModelProjection.apply(state, positionEvent(2, 'bob', 'airline', 'JAL'));
    expect(state.dimensions.get('airline')?.size).toBe(2);
    expect(objectiveModelProjection.version(state)).toBe(2);
  });

  it('last-write-wins per participant per dimension', () => {
    let state = objectiveModelProjection.initial();
    state = objectiveModelProjection.apply(state, positionEvent(1, 'alice', 'airline', 'ANA'));
    state = objectiveModelProjection.apply(state, positionEvent(2, 'alice', 'airline', 'JAL'));
    expect(state.dimensions.get('airline')?.get('alice')?.value).toBe('JAL');
    expect(state.dimensions.get('airline')?.size).toBe(1);
  });
});

describe('reconcileAllDimensions', () => {
  it('reports insufficient-coverage when a present participant has no position yet', () => {
    let state = objectiveModelProjection.initial();
    state = objectiveModelProjection.apply(state, positionEvent(1, 'alice', 'airline', 'ANA'));
    const results = reconcileAllDimensions(state, ['alice', 'bob'], DIMENSIONS);
    expect(results.get('airline')).toEqual({ status: 'open', reason: 'insufficient-coverage' });
  });

  it('reconciles once every present participant has weighed in', () => {
    let state = objectiveModelProjection.initial();
    state = objectiveModelProjection.apply(state, positionEvent(1, 'alice', 'airline', 'ANA'));
    state = objectiveModelProjection.apply(state, positionEvent(2, 'bob', 'airline', 'ANA'));
    const results = reconcileAllDimensions(state, ['alice', 'bob'], DIMENSIONS);
    expect(results.get('airline')).toEqual({ status: 'aligned', value: 'ANA' });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/core/projections/objective-model.test.ts`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Create `src/core/projections/types.ts`**

```ts
export interface StructuralEvent<P = unknown> {
  seq: number;
  type: string;
  payload: P;
  ts: number;
}

export interface Projection<S> {
  readonly name: string;
  initial(): S;
  apply(state: S, event: StructuralEvent): S;
  version(state: S): number;
}
```

- [ ] **Step 4: Implement `src/core/projections/objective-model.ts`**

```ts
import type { Position, Reconciliation, DimensionSpec } from '../comparators/types.js';
import type { Strength } from '../classification/types.js';
import type { Projection, StructuralEvent } from './types.js';

export interface ObjectiveModelState {
  dimensions: Map<string, Map<string, Position>>;
  ratified: Map<string, { value: unknown; seq: number }>;
  lastObservationSeq: number;
}

export const objectiveModelProjection: Projection<ObjectiveModelState> = {
  name: 'objective-model',
  initial: () => ({ dimensions: new Map(), ratified: new Map(), lastObservationSeq: 0 }),
  apply(state, event: StructuralEvent) {
    if (event.type === 'ObjectivePositionRecorded') {
      const { participantId, dimensionId, value, strength } = event.payload as {
        participantId: string;
        dimensionId: string;
        value: unknown;
        strength: Strength;
      };
      const dimMap = state.dimensions.get(dimensionId) ?? new Map<string, Position>();
      dimMap.set(participantId, { participantId, value, strength, sourceSeq: event.seq, ts: event.ts });
      state.dimensions.set(dimensionId, dimMap);
      state.lastObservationSeq = event.seq;
    } else if (event.type === 'DecisionRatified') {
      const { dimensionId, value } = event.payload as { dimensionId: string; value: unknown };
      state.ratified.set(dimensionId, { value, seq: event.seq });
    }
    return state;
  },
  version: (state) => state.lastObservationSeq,
};

export function reconcileAllDimensions(
  model: ObjectiveModelState,
  presentIds: string[],
  dimensions: DimensionSpec[],
): Map<string, Reconciliation> {
  const results = new Map<string, Reconciliation>();
  for (const dim of dimensions) {
    const posMap = model.dimensions.get(dim.id) ?? new Map<string, Position>();
    const positions = presentIds.map((id) => posMap.get(id)).filter((p): p is Position => !!p);
    if (positions.length < presentIds.length) {
      results.set(dim.id, { status: 'open', reason: 'insufficient-coverage' });
      continue;
    }
    results.set(dim.id, dim.comparator.reconcile(positions));
  }
  return results;
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run src/core/projections/objective-model.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 6: Commit**

```bash
git add src/core/projections/types.ts src/core/projections/objective-model.ts src/core/projections/objective-model.test.ts
git commit -m "feat: objective-model projection and cross-dimension reconciliation"
```

---

### Task 6: ProjectionRegistry + canonical + presence projections + SessionEvent types

**Files:**
- Create: `src/core/events/types.ts`
- Create: `src/core/projections/canonical.ts`
- Create: `src/core/projections/presence.ts`
- Create: `src/core/projections/registry.ts`
- Test: `src/core/projections/registry.test.ts`

**Interfaces:**
- Consumes: `Projection<S>` (Task 5)
- Produces: `IncomingMessage`, `Signal<T>`, `Actor`, `SessionEvent<P>`, `Command<P>` (all in `events/types.ts`); `CanonicalState`, `canonicalProjection`; `PresenceState`, `presenceProjection`; `ProjectionRegistry` class with `apply(event)`, `get<S>(name)`, `getVersion(name)`, `rebuild(log)`

- [ ] **Step 1: Create `src/core/events/types.ts`**

```ts
export interface IncomingMessage {
  id: string;
  sessionId: string;
  speakerId: string;
  speakerRole: 'human' | 'agent';
  text: string;
  ts: number;
  mentions: string[];
  replyTo?: string;
}

export interface Signal<T> {
  value: T;
  confidence: number;
  rationale?: string;
}

export type Actor = { kind: 'human'; participantId: string } | { kind: 'agent'; agentId: string; triggeredBy: Actor } | { kind: 'system' };

export interface SessionEvent<P = unknown> {
  seq: number;
  sessionId: string;
  type: string;
  actor: Actor;
  payload: P;
  correlationId?: string;
  ts: number;
}

export interface Command<P = unknown> {
  type: string;
  actor: Actor;
  payload: P;
  expectedVersion?: number;
}
```

- [ ] **Step 2: Create `src/core/projections/canonical.ts`**

```ts
import type { Projection, StructuralEvent } from './types.js';

export interface CanonicalState {
  ratified: Record<string, unknown>;
  lastRatifiedSeq: number;
}

export const canonicalProjection: Projection<CanonicalState> = {
  name: 'canonical',
  initial: () => ({ ratified: {}, lastRatifiedSeq: 0 }),
  apply(state, event: StructuralEvent) {
    if (event.type === 'DecisionRatified') {
      const { dimensionId, value } = event.payload as { dimensionId: string; value: unknown };
      state.ratified[dimensionId] = value;
      state.lastRatifiedSeq = event.seq;
    }
    return state;
  },
  version: (state) => state.lastRatifiedSeq,
};
```

- [ ] **Step 3: Create `src/core/projections/presence.ts`**

```ts
import type { Projection, StructuralEvent } from './types.js';

export interface PresenceState {
  participants: Map<string, { displayName: string; connected: boolean; joinedAt: number }>;
  lastSeq: number;
}

export const presenceProjection: Projection<PresenceState> = {
  name: 'presence',
  initial: () => ({ participants: new Map(), lastSeq: 0 }),
  apply(state, event: StructuralEvent) {
    if (event.type === 'ParticipantJoined') {
      const { participantId, displayName } = event.payload as { participantId: string; displayName: string };
      const existing = state.participants.get(participantId);
      state.participants.set(participantId, {
        displayName,
        connected: true,
        joinedAt: existing?.joinedAt ?? event.ts,
      });
      state.lastSeq = event.seq;
    } else if (event.type === 'ParticipantLeft') {
      const { participantId } = event.payload as { participantId: string };
      const existing = state.participants.get(participantId);
      if (existing) state.participants.set(participantId, { ...existing, connected: false });
      state.lastSeq = event.seq;
    }
    return state;
  },
  version: (state) => state.lastSeq,
};

export function presentParticipantIds(state: PresenceState): string[] {
  return [...state.participants.entries()].filter(([, p]) => p.connected).map(([id]) => id);
}
```

- [ ] **Step 4: Write the failing test for ProjectionRegistry**

```ts
// src/core/projections/registry.test.ts
import { describe, it, expect } from 'vitest';
import { ProjectionRegistry } from './registry.js';
import { objectiveModelProjection } from './objective-model.js';
import { canonicalProjection } from './canonical.js';
import { presenceProjection } from './presence.js';

describe('ProjectionRegistry', () => {
  it('applies one event across all registered projections', () => {
    const registry = new ProjectionRegistry([objectiveModelProjection, canonicalProjection, presenceProjection]);
    registry.apply({
      seq: 1,
      sessionId: 's1',
      type: 'ParticipantJoined',
      actor: { kind: 'system' },
      payload: { participantId: 'alice', displayName: 'Alice' },
      ts: 1,
    });
    expect(registry.get<any>('presence').participants.get('alice')?.connected).toBe(true);
    expect(registry.getVersion('presence')).toBe(1);
  });

  it('rebuild replays a full log from scratch', () => {
    const registry = new ProjectionRegistry([presenceProjection]);
    const log = [
      { seq: 1, sessionId: 's1', type: 'ParticipantJoined', actor: { kind: 'system' as const }, payload: { participantId: 'alice', displayName: 'Alice' }, ts: 1 },
      { seq: 2, sessionId: 's1', type: 'ParticipantLeft', actor: { kind: 'system' as const }, payload: { participantId: 'alice' }, ts: 2 },
    ];
    registry.rebuild(log);
    expect(registry.get<any>('presence').participants.get('alice')?.connected).toBe(false);
    expect(registry.getVersion('presence')).toBe(2);
  });
});
```

- [ ] **Step 5: Run test to verify it fails**

Run: `npx vitest run src/core/projections/registry.test.ts`
Expected: FAIL — module does not exist.

- [ ] **Step 6: Implement `src/core/projections/registry.ts`**

```ts
import type { Projection } from './types.js';
import type { SessionEvent } from '../events/types.js';

export class ProjectionRegistry {
  private states = new Map<string, unknown>();
  private byName = new Map<string, Projection<unknown>>();

  constructor(projections: Projection<unknown>[]) {
    for (const p of projections) {
      this.byName.set(p.name, p);
      this.states.set(p.name, p.initial());
    }
  }

  apply(event: SessionEvent): void {
    for (const [name, p] of this.byName) {
      this.states.set(name, p.apply(this.states.get(name), event));
    }
  }

  get<S>(name: string): S {
    return this.states.get(name) as S;
  }

  getVersion(name: string): number {
    const p = this.byName.get(name);
    if (!p) throw new Error(`Unknown projection: ${name}`);
    return p.version(this.states.get(name));
  }

  rebuild(log: Iterable<SessionEvent>): void {
    for (const [name, p] of this.byName) this.states.set(name, p.initial());
    for (const event of log) this.apply(event);
  }
}
```

- [ ] **Step 7: Run test to verify it passes**

Run: `npx vitest run src/core/projections/registry.test.ts`
Expected: PASS (2 tests)

- [ ] **Step 8: Commit**

```bash
git add src/core/events/types.ts src/core/projections/canonical.ts src/core/projections/presence.ts src/core/projections/registry.ts src/core/projections/registry.test.ts
git commit -m "feat: ProjectionRegistry, canonical and presence projections, event types"
```

---

### Task 7: `toObservationEvents` pure mapper

**Files:**
- Create: `src/core/classification/types.ts` (extend — currently only has `Strength`)
- Create: `src/core/events/to-observation-events.ts`
- Test: `src/core/events/to-observation-events.test.ts`

**Interfaces:**
- Consumes: `IncomingMessage`, `SessionEvent`, `Signal` (Task 6); `Strength` (Task 1)
- Produces: `Addressee`, `Actionability`, `RawObservation`, `ClassifierOutput`, `ObservationPayload`, `MessageSignals` (all in `classification/types.ts`); `toObservationEvents(msg, signals, nextSeq): SessionEvent[]`

- [ ] **Step 1: Overwrite `src/core/classification/types.ts` with the full set of types**

```ts
import type { Signal } from '../events/types.js';

export type Strength = 'lean' | 'prefer' | 'insist';

export type Addressee =
  | { kind: 'agent' }
  | { kind: 'human'; participantId: string }
  | { kind: 'group' }
  | { kind: 'none' };

export type Actionability =
  | { kind: 'command'; intent: string }
  | { kind: 'question' }
  | { kind: 'deliberation' }
  | { kind: 'social' };

export interface RawObservation {
  participantId: string;
  text: string;
  hint?: 'objective' | 'constraint' | 'proposal';
}

export interface ClassifierOutput {
  addressee: Signal<Addressee>;
  actionability: Signal<Actionability>;
  observations: Signal<RawObservation[]>;
}

export type ObservationPayload =
  | { scope: 'participant-objective'; participantId: string; dimensionId: string; value: unknown; strength: Strength }
  | { scope: 'constraint'; participantId: string; dimensionId: string; bound: unknown }
  | { scope: 'shared-proposal'; proposalId: string; summary: string };

export interface MessageSignals {
  addressee: Signal<Addressee>;
  actionability: Signal<Actionability>;
  observations: Signal<ObservationPayload[]>;
}
```

- [ ] **Step 2: Write the failing test**

```ts
// src/core/events/to-observation-events.test.ts
import { describe, it, expect } from 'vitest';
import { toObservationEvents } from './to-observation-events.js';
import type { IncomingMessage } from './types.js';
import type { MessageSignals } from '../classification/types.js';

const msg: IncomingMessage = {
  id: 'm1',
  sessionId: 's1',
  speakerId: 'alice',
  speakerRole: 'human',
  text: 'I want ANA',
  ts: 100,
  mentions: [],
};

describe('toObservationEvents', () => {
  it('maps a participant-objective observation to ObjectivePositionRecorded', () => {
    const signals: MessageSignals = {
      addressee: { value: { kind: 'group' }, confidence: 0.9 },
      actionability: { value: { kind: 'deliberation' }, confidence: 0.9 },
      observations: {
        value: [{ scope: 'participant-objective', participantId: 'alice', dimensionId: 'airline', value: 'ANA', strength: 'prefer' }],
        confidence: 0.9,
      },
    };
    let seq = 0;
    const events = toObservationEvents(msg, signals, () => ++seq);
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe('ObjectivePositionRecorded');
    expect(events[0].payload).toEqual({ participantId: 'alice', dimensionId: 'airline', value: 'ANA', strength: 'prefer' });
    expect(events[0].correlationId).toBe('m1');
  });

  it('produces no events for an empty observation list', () => {
    const signals: MessageSignals = {
      addressee: { value: { kind: 'none' }, confidence: 0.9 },
      actionability: { value: { kind: 'social' }, confidence: 0.9 },
      observations: { value: [], confidence: 0.9 },
    };
    let seq = 0;
    expect(toObservationEvents(msg, signals, () => ++seq)).toHaveLength(0);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run src/core/events/to-observation-events.test.ts`
Expected: FAIL — module does not exist.

- [ ] **Step 4: Implement `src/core/events/to-observation-events.ts`**

```ts
import type { IncomingMessage, SessionEvent } from './types.js';
import type { MessageSignals } from '../classification/types.js';

export function toObservationEvents(
  msg: IncomingMessage,
  signals: MessageSignals,
  nextSeq: () => number,
): SessionEvent[] {
  return signals.observations.value.map((obs) => {
    if (obs.scope === 'participant-objective') {
      return {
        seq: nextSeq(),
        sessionId: msg.sessionId,
        type: 'ObjectivePositionRecorded',
        actor: { kind: 'human' as const, participantId: obs.participantId },
        payload: { participantId: obs.participantId, dimensionId: obs.dimensionId, value: obs.value, strength: obs.strength },
        correlationId: msg.id,
        ts: msg.ts,
      };
    }
    if (obs.scope === 'constraint') {
      return {
        seq: nextSeq(),
        sessionId: msg.sessionId,
        type: 'ConstraintRecorded',
        actor: { kind: 'human' as const, participantId: obs.participantId },
        payload: { participantId: obs.participantId, dimensionId: obs.dimensionId, bound: obs.bound },
        correlationId: msg.id,
        ts: msg.ts,
      };
    }
    return {
      seq: nextSeq(),
      sessionId: msg.sessionId,
      type: 'ProposalRecorded',
      actor: { kind: 'human' as const, participantId: msg.speakerId },
      payload: { proposalId: obs.proposalId, summary: obs.summary },
      correlationId: msg.id,
      ts: msg.ts,
    };
  });
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run src/core/events/to-observation-events.test.ts`
Expected: PASS (2 tests)

- [ ] **Step 6: Commit**

```bash
git add src/core/classification/types.ts src/core/events/to-observation-events.ts src/core/events/to-observation-events.test.ts
git commit -m "feat: full classification types and toObservationEvents mapper"
```

---

### Task 8: Routing — types, default rule chain, policy

**Files:**
- Create: `src/core/routing/types.ts`
- Create: `src/core/routing/rules.ts`
- Create: `src/core/routing/policy.ts`
- Test: `src/core/routing/policy.test.ts`

**Interfaces:**
- Consumes: `MessageSignals` (Task 7), `PresenceState` (Task 6)
- Produces: `RouteDecision`, `RoutingPolicyConfig`, `InvokeVerdict`, `RoutingRule`, `SessionContext { sessionId: string; presence: PresenceState }`, `defaultRuleChain: RoutingRule[]`, `DEFAULT_CONFIG: RoutingPolicyConfig`, `RuleBasedRoutingPolicy` implementing `decide(signals, ctx): RouteDecision`

- [ ] **Step 1: Create `src/core/routing/types.ts`**

```ts
import type { MessageSignals } from '../classification/types.js';
import type { PresenceState } from '../projections/presence.js';

export interface SessionContext {
  sessionId: string;
  presence: PresenceState;
}

export interface RouteDecision {
  applyObservations: boolean;
  invokeAgent: boolean;
  label: 'act' | 'listen' | 'ignore';
  reason: string;
}

export interface RoutingPolicyConfig {
  addressedThreshold: number;
  actionThreshold: number;
  invokeOnGroupQuestion: boolean;
}

export type InvokeVerdict = { invoke: boolean; reason: string };

export interface RoutingRule {
  readonly name: string;
  test(signals: MessageSignals, cfg: RoutingPolicyConfig, ctx: SessionContext): InvokeVerdict | null;
}

export interface RoutingPolicy {
  decide(signals: MessageSignals, ctx: SessionContext): RouteDecision;
}

export const DEFAULT_CONFIG: RoutingPolicyConfig = {
  addressedThreshold: 0.6,
  actionThreshold: 0.6,
  invokeOnGroupQuestion: true,
};
```

- [ ] **Step 2: Create `src/core/routing/rules.ts`**

```ts
import type { RoutingRule } from './types.js';

export const humanToHumanRule: RoutingRule = {
  name: 'human-to-human',
  test: (signals) => (signals.addressee.value.kind === 'human' ? { invoke: false, reason: 'addressed to another human' } : null),
};

export const socialRule: RoutingRule = {
  name: 'social',
  test: (signals) => (signals.actionability.value.kind === 'social' ? { invoke: false, reason: 'purely social message' } : null),
};

export const deliberationRule: RoutingRule = {
  name: 'deliberation',
  test: (signals) =>
    signals.actionability.value.kind === 'deliberation' && signals.addressee.value.kind !== 'agent'
      ? { invoke: false, reason: 'humans deliberating, agent listens silently' }
      : null,
};

export const directRequestRule: RoutingRule = {
  name: 'direct-request',
  test: (signals, cfg) =>
    signals.addressee.value.kind === 'agent' && signals.addressee.confidence >= cfg.addressedThreshold
      ? { invoke: true, reason: 'directly addressed to the agent' }
      : null,
};

export const groupCommandRule: RoutingRule = {
  name: 'group-command',
  test: (signals, cfg) =>
    signals.addressee.value.kind === 'group' &&
    signals.actionability.value.kind === 'command' &&
    signals.actionability.confidence >= cfg.actionThreshold
      ? { invoke: true, reason: 'command directed at the group' }
      : null,
};

export const groupQuestionRule: RoutingRule = {
  name: 'group-question',
  test: (signals, cfg) => {
    if (!cfg.invokeOnGroupQuestion) return null;
    return signals.addressee.value.kind === 'group' &&
      signals.actionability.value.kind === 'question' &&
      signals.actionability.confidence >= cfg.actionThreshold
      ? { invoke: true, reason: 'question directed at the group' }
      : null;
  },
};

export const defaultRuleChain: RoutingRule[] = [
  humanToHumanRule,
  socialRule,
  deliberationRule,
  directRequestRule,
  groupCommandRule,
  groupQuestionRule,
];
```

- [ ] **Step 3: Write the failing test for the policy**

```ts
// src/core/routing/policy.test.ts
import { describe, it, expect } from 'vitest';
import { RuleBasedRoutingPolicy } from './policy.js';
import type { MessageSignals } from '../classification/types.js';
import type { SessionContext } from './types.js';

const ctx: SessionContext = { sessionId: 's1', presence: { participants: new Map(), lastSeq: 0 } };

function signals(overrides: Partial<MessageSignals>): MessageSignals {
  return {
    addressee: { value: { kind: 'none' }, confidence: 1 },
    actionability: { value: { kind: 'social' }, confidence: 1 },
    observations: { value: [], confidence: 1 },
    ...overrides,
  };
}

describe('RuleBasedRoutingPolicy', () => {
  const policy = new RuleBasedRoutingPolicy();

  it('invokes the agent when directly addressed', () => {
    const decision = policy.decide(signals({ addressee: { value: { kind: 'agent' }, confidence: 0.9 } }), ctx);
    expect(decision.invokeAgent).toBe(true);
    expect(decision.reason).toMatch(/^direct-request:/);
  });

  it('stays silent by default with no matching rule', () => {
    const decision = policy.decide(signals({ actionability: { value: { kind: 'deliberation' }, confidence: 0.9 } }), ctx);
    expect(decision.invokeAgent).toBe(false);
    expect(decision.reason).toMatch(/^deliberation:/);
  });

  it('always sets applyObservations=false for social messages', () => {
    const decision = policy.decide(signals({}), ctx);
    expect(decision.applyObservations).toBe(false);
  });

  it('sets applyObservations=true for non-social messages', () => {
    const decision = policy.decide(signals({ actionability: { value: { kind: 'deliberation' }, confidence: 0.9 } }), ctx);
    expect(decision.applyObservations).toBe(true);
  });
});
```

- [ ] **Step 4: Run test to verify it fails**

Run: `npx vitest run src/core/routing/policy.test.ts`
Expected: FAIL — module does not exist.

- [ ] **Step 5: Implement `src/core/routing/policy.ts`**

```ts
import type { MessageSignals } from '../classification/types.js';
import { defaultRuleChain } from './rules.js';
import { DEFAULT_CONFIG } from './types.js';
import type { RouteDecision, RoutingPolicy, RoutingPolicyConfig, RoutingRule, SessionContext } from './types.js';

export class RuleBasedRoutingPolicy implements RoutingPolicy {
  constructor(
    private rules: RoutingRule[] = defaultRuleChain,
    private cfg: RoutingPolicyConfig = DEFAULT_CONFIG,
  ) {}

  decide(signals: MessageSignals, ctx: SessionContext): RouteDecision {
    const applyObservations = signals.actionability.value.kind !== 'social';

    for (const rule of this.rules) {
      const verdict = rule.test(signals, this.cfg, ctx);
      if (verdict) {
        return {
          applyObservations,
          invokeAgent: verdict.invoke,
          label: verdict.invoke ? 'act' : applyObservations ? 'listen' : 'ignore',
          reason: `${rule.name}: ${verdict.reason}`,
        };
      }
    }

    return { applyObservations, invokeAgent: false, label: 'listen', reason: 'default-silence' };
  }
}
```

- [ ] **Step 6: Run test to verify it passes**

Run: `npx vitest run src/core/routing/policy.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 7: Commit**

```bash
git add src/core/routing/types.ts src/core/routing/rules.ts src/core/routing/policy.ts src/core/routing/policy.test.ts
git commit -m "feat: routing policy and default rule chain"
```

---

### Task 9: `AlignmentDetector`

**Files:**
- Create: `src/core/facilitation/types.ts`
- Create: `src/core/facilitation/detector.ts`
- Test: `src/core/facilitation/detector.test.ts`

**Interfaces:**
- Consumes: `ObjectiveModelState`, `reconcileAllDimensions` (Task 5), `PresenceState`, `presentParticipantIds` (Task 6), `DimensionSpec` (Task 1)
- Produces: `FacilitationTrigger` (union, with v0 extensions `values` on `alignment-reached` and `detail` on `conflict-detected`), `AlignmentDetector` interface, `AlignmentDetectorImpl`

- [ ] **Step 1: Create `src/core/facilitation/types.ts`**

```ts
import type { Actionability } from '../classification/types.js';
import type { ObjectiveModelState } from '../projections/objective-model.js';
import type { PresenceState } from '../projections/presence.js';

export type FacilitationTrigger =
  | { kind: 'alignment-reached'; summary: string; values: Record<string, unknown> }
  | { kind: 'conflict-detected'; between: string[]; on: string; detail: string }
  | { kind: 'stalled'; since: number };
// Note: 'stalled' is part of the type for contract fidelity but is never
// constructed in v0 — see Global Constraints for why.

export interface AlignmentDetector {
  evaluate(model: ObjectiveModelState, presence: PresenceState): FacilitationTrigger[];
}

export interface TurnContext {
  reactiveInvoked: boolean;
  lastActionability: Actionability;
  recentFacilitations: { kind: string; at: number }[];
}

export type FacilitationOutcome = { action: 'surface' } | { action: 'fold' } | { action: 'suppress'; reason: string };

export interface FacilitationGate {
  admit(trigger: FacilitationTrigger, turn: TurnContext, now: number): FacilitationOutcome;
}
```

- [ ] **Step 2: Write the failing test**

```ts
// src/core/facilitation/detector.test.ts
import { describe, it, expect } from 'vitest';
import { AlignmentDetectorImpl } from './detector.js';
import { objectiveModelProjection } from '../projections/objective-model.js';
import { presenceProjection } from '../projections/presence.js';
import { DIMENSIONS } from '../../domain/japan-trip.js';

function joined(seq: number, participantId: string) {
  return { seq, type: 'ParticipantJoined', payload: { participantId, displayName: participantId }, ts: seq };
}
function positionEvent(seq: number, participantId: string, dimensionId: string, value: unknown, strength = 'insist') {
  return { seq, type: 'ObjectivePositionRecorded', payload: { participantId, dimensionId, value, strength }, ts: seq };
}

describe('AlignmentDetectorImpl', () => {
  const detector = new AlignmentDetectorImpl(DIMENSIONS);

  it('fires alignment-reached only once all 4 dimensions align for all present participants', () => {
    let presence = presenceProjection.initial();
    presence = presenceProjection.apply(presence, joined(1, 'alice'));
    presence = presenceProjection.apply(presence, joined(2, 'bob'));

    let model = objectiveModelProjection.initial();
    const dates = { min: 1000, max: 2000 };
    const budget = { min: 500, max: 1000 };
    const places = ['Tokyo', 'Kyoto', 'Osaka'];
    for (const [seq, participantId] of [[10, 'alice'], [11, 'bob']] as const) {
      model = objectiveModelProjection.apply(model, positionEvent(seq, participantId, 'dates', dates));
      model = objectiveModelProjection.apply(model, positionEvent(seq + 1, participantId, 'budget', budget));
      model = objectiveModelProjection.apply(model, positionEvent(seq + 2, participantId, 'places', places));
      model = objectiveModelProjection.apply(model, positionEvent(seq + 3, participantId, 'airline', 'ANA'));
    }

    const triggers = detector.evaluate(model, presence);
    expect(triggers).toEqual([
      { kind: 'alignment-reached', summary: expect.any(String), values: { dates, budget, places, airline: 'ANA' } },
    ]);
  });

  it('reports a conflict-detected trigger for a dimension with competing insist positions', () => {
    let presence = presenceProjection.initial();
    presence = presenceProjection.apply(presence, joined(1, 'alice'));
    presence = presenceProjection.apply(presence, joined(2, 'bob'));

    let model = objectiveModelProjection.initial();
    model = objectiveModelProjection.apply(model, positionEvent(10, 'alice', 'airline', 'ANA', 'insist'));
    model = objectiveModelProjection.apply(model, positionEvent(11, 'bob', 'airline', 'JAL', 'insist'));

    const triggers = detector.evaluate(model, presence);
    expect(triggers.some((t) => t.kind === 'conflict-detected' && t.on === 'airline')).toBe(true);
  });

  it('produces no triggers when nobody is present', () => {
    const presence = presenceProjection.initial();
    const model = objectiveModelProjection.initial();
    expect(detector.evaluate(model, presence)).toEqual([]);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run src/core/facilitation/detector.test.ts`
Expected: FAIL — module does not exist.

- [ ] **Step 4: Implement `src/core/facilitation/detector.ts`**

```ts
import type { DimensionSpec } from '../comparators/types.js';
import { reconcileAllDimensions, type ObjectiveModelState } from '../projections/objective-model.js';
import { presentParticipantIds, type PresenceState } from '../projections/presence.js';
import type { AlignmentDetector, FacilitationTrigger } from './types.js';

export class AlignmentDetectorImpl implements AlignmentDetector {
  constructor(private dimensions: DimensionSpec[]) {}

  evaluate(model: ObjectiveModelState, presence: PresenceState): FacilitationTrigger[] {
    const presentIds = presentParticipantIds(presence);
    if (presentIds.length === 0) return [];

    const results = reconcileAllDimensions(model, presentIds, this.dimensions);
    const triggers: FacilitationTrigger[] = [];
    const aligned: Record<string, unknown> = {};
    let allAligned = true;

    for (const dim of this.dimensions) {
      const result = results.get(dim.id)!;
      if (result.status === 'aligned') {
        aligned[dim.id] = result.value;
      } else {
        allAligned = false;
        if (result.status === 'conflict') {
          triggers.push({ kind: 'conflict-detected', between: result.between, on: dim.id, detail: result.detail });
        }
      }
    }

    if (allAligned) {
      triggers.push({
        kind: 'alignment-reached',
        summary: `Aligned on ${this.dimensions.map((d) => d.id).join(', ')}`,
        values: aligned,
      });
    }

    return triggers;
  }
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run src/core/facilitation/detector.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 6: Commit**

```bash
git add src/core/facilitation/types.ts src/core/facilitation/detector.ts src/core/facilitation/detector.test.ts
git commit -m "feat: AlignmentDetector"
```

---

### Task 10: `FacilitationGate`

**Files:**
- Create: `src/core/facilitation/gate.ts`
- Test: `src/core/facilitation/gate.test.ts`

**Interfaces:**
- Consumes: `FacilitationTrigger`, `TurnContext`, `FacilitationOutcome`, `FacilitationGate` (Task 9)
- Produces: `RuleBasedFacilitationGate` implementing `admit(trigger, turn, now): FacilitationOutcome`; `facilitationKey(trigger): string` (exported so the workflow can record debounce entries with the exact same key)

- [ ] **Step 1: Write the failing test**

```ts
// src/core/facilitation/gate.test.ts
import { describe, it, expect } from 'vitest';
import { RuleBasedFacilitationGate, facilitationKey } from './gate.js';
import type { FacilitationTrigger, TurnContext } from './types.js';

const alignmentTrigger: FacilitationTrigger = { kind: 'alignment-reached', summary: 'aligned', values: {} };
const baseTurn: TurnContext = { reactiveInvoked: false, lastActionability: { kind: 'deliberation' }, recentFacilitations: [] };

describe('RuleBasedFacilitationGate', () => {
  const gate = new RuleBasedFacilitationGate();

  it('surfaces a fresh trigger when nothing else is happening', () => {
    const outcome = gate.admit(alignmentTrigger, { ...baseTurn, lastActionability: { kind: 'command', intent: 'finalize' } }, 1000);
    expect(outcome).toEqual({ action: 'surface' });
  });

  it('folds into the reactive turn if the agent already responded this tick', () => {
    const outcome = gate.admit(
      alignmentTrigger,
      { ...baseTurn, reactiveInvoked: true, lastActionability: { kind: 'command', intent: 'finalize' } },
      1000,
    );
    expect(outcome).toEqual({ action: 'fold' });
  });

  it('suppresses while the group is mid-deliberation', () => {
    const outcome = gate.admit(alignmentTrigger, baseTurn, 1000);
    expect(outcome.action).toBe('suppress');
  });

  it('debounces a trigger that fired recently', () => {
    const turn: TurnContext = {
      ...baseTurn,
      lastActionability: { kind: 'command', intent: 'finalize' },
      recentFacilitations: [{ kind: facilitationKey(alignmentTrigger), at: 900 }],
    };
    const outcome = gate.admit(alignmentTrigger, turn, 1000);
    expect(outcome.action).toBe('suppress');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/core/facilitation/gate.test.ts`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement `src/core/facilitation/gate.ts`**

```ts
import type { FacilitationGate, FacilitationOutcome, FacilitationTrigger, TurnContext } from './types.js';

const COOLDOWN_MS = 30_000;

export function facilitationKey(trigger: FacilitationTrigger): string {
  return trigger.kind === 'conflict-detected' ? `conflict-detected:${trigger.on}` : trigger.kind;
}

export class RuleBasedFacilitationGate implements FacilitationGate {
  admit(trigger: FacilitationTrigger, turn: TurnContext, now: number): FacilitationOutcome {
    const key = facilitationKey(trigger);
    const recent = turn.recentFacilitations.find((f) => f.kind === key && now - f.at < COOLDOWN_MS);
    if (recent) return { action: 'suppress', reason: `debounced: ${key} fired recently` };

    if (turn.lastActionability.kind === 'deliberation') {
      return { action: 'suppress', reason: 'suppressing mid-deliberation' };
    }

    if (turn.reactiveInvoked) return { action: 'fold' };

    return { action: 'surface' };
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/core/facilitation/gate.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add src/core/facilitation/gate.ts src/core/facilitation/gate.test.ts
git commit -m "feat: FacilitationGate"
```

---

### Task 11: Classifier activity (Claude-backed)

**Files:**
- Create: `src/activities/anthropic-like.ts`
- Create: `src/activities/classifier.ts`
- Test: `src/activities/classifier.test.ts`

**Interfaces:**
- Consumes: `IncomingMessage` (Task 6), `ClassifierOutput` (Task 7)
- Produces: `AnthropicLike` interface (minimal DI seam over the Anthropic SDK), `createClassifier(client: AnthropicLike): { classify(msg: IncomingMessage): Promise<ClassifierOutput> }`

- [ ] **Step 1: Create `src/activities/anthropic-like.ts`**

```ts
export interface AnthropicLike {
  messages: {
    create(params: { model: string; max_tokens: number; messages: { role: 'user'; content: string }[] }): Promise<{
      content: { type: string; text?: string }[];
    }>;
  };
}

export function extractJsonObject(text: string): string {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end === -1) throw new Error(`No JSON object found in model response: ${text}`);
  return text.slice(start, end + 1);
}

export function extractJsonArray(text: string): string {
  const start = text.indexOf('[');
  const end = text.lastIndexOf(']');
  if (start === -1 || end === -1) throw new Error(`No JSON array found in model response: ${text}`);
  return text.slice(start, end + 1);
}

export async function callClaudeText(client: AnthropicLike, prompt: string, maxTokens = 1024): Promise<string> {
  const response = await client.messages.create({
    model: 'claude-sonnet-5',
    max_tokens: maxTokens,
    messages: [{ role: 'user', content: prompt }],
  });
  const block = response.content.find((b) => b.type === 'text');
  if (!block?.text) throw new Error('Model returned no text content');
  return block.text;
}
```

- [ ] **Step 2: Write the failing test**

```ts
// src/activities/classifier.test.ts
import { describe, it, expect } from 'vitest';
import { createClassifier } from './classifier.js';
import type { AnthropicLike } from './anthropic-like.js';
import type { IncomingMessage } from '../core/events/types.js';

function fakeClient(responseText: string): AnthropicLike {
  return { messages: { create: async () => ({ content: [{ type: 'text', text: responseText }] }) } };
}

const msg: IncomingMessage = {
  id: 'm1',
  sessionId: 's1',
  speakerId: 'alice',
  speakerRole: 'human',
  text: 'hey agent, what do you think about ANA?',
  ts: 1,
  mentions: [],
};

describe('createClassifier', () => {
  it('parses a well-formed classifier response into ClassifierOutput', async () => {
    const json = JSON.stringify({
      addressee: { kind: 'agent', confidence: 0.95 },
      actionability: { kind: 'question', confidence: 0.9 },
      observations: [{ participantId: 'alice', text: 'ANA' }],
    });
    const { classify } = createClassifier(fakeClient(`Here you go:\n${json}\nThanks!`));
    const result = await classify(msg);
    expect(result.addressee.value).toEqual({ kind: 'agent', confidence: 0.95 });
    expect(result.actionability.value.kind).toBe('question');
    expect(result.observations.value).toEqual([{ participantId: 'alice', text: 'ANA' }]);
  });

  it('throws if the model response contains no JSON object', async () => {
    const { classify } = createClassifier(fakeClient('no json here'));
    await expect(classify(msg)).rejects.toThrow();
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run src/activities/classifier.test.ts`
Expected: FAIL — module does not exist.

- [ ] **Step 4: Implement `src/activities/classifier.ts`**

```ts
import type { AnthropicLike } from './anthropic-like.js';
import { callClaudeText, extractJsonObject } from './anthropic-like.js';
import type { IncomingMessage } from '../core/events/types.js';
import type { ClassifierOutput } from '../core/classification/types.js';

export function createClassifier(client: AnthropicLike) {
  async function classify(msg: IncomingMessage): Promise<ClassifierOutput> {
    const prompt = `You are a message classifier for a group chat. Given a message, output ONLY JSON with this exact shape:
{
  "addressee": { "kind": "agent" | "human" | "group" | "none", "participantId"?: string, "confidence": number },
  "actionability": { "kind": "command" | "question" | "deliberation" | "social", "intent"?: string, "confidence": number },
  "observations": [ { "participantId": string, "text": string } ]
}
Rules:
- "addressee.kind" is "agent" only if the message clearly directs itself at an AI assistant (e.g. "hey agent", "@assistant").
- "actionability.kind" is "deliberation" when humans are negotiating/discussing among themselves, "social" for chatter/thanks with no substantive content.
- "observations" lists any preferences, constraints, or proposals the speaker stated, verbatim.

Speaker: ${msg.speakerId}
Message: "${msg.text}"`;

    const text = await callClaudeText(client, prompt);
    const parsed = JSON.parse(extractJsonObject(text));

    return {
      addressee: { value: parsed.addressee, confidence: parsed.addressee.confidence },
      actionability: { value: parsed.actionability, confidence: parsed.actionability.confidence },
      observations: {
        value: parsed.observations.map((o: { participantId: string; text: string }) => ({ participantId: o.participantId, text: o.text })),
        confidence: 1,
      },
    };
  }

  return { classify };
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run src/activities/classifier.test.ts`
Expected: PASS (2 tests)

- [ ] **Step 6: Commit**

```bash
git add src/activities/anthropic-like.ts src/activities/classifier.ts src/activities/classifier.test.ts
git commit -m "feat: Claude-backed classifier activity"
```

---

### Task 12: Normalizer activity + ClassifierPipeline

**Files:**
- Create: `src/activities/normalizer.ts`
- Create: `src/activities/classifier-pipeline.ts`
- Test: `src/activities/normalizer.test.ts`
- Test: `src/activities/classifier-pipeline.test.ts`

**Interfaces:**
- Consumes: `AnthropicLike`, `callClaudeText`, `extractJsonArray` (Task 11); `RawObservation`, `ObservationPayload`, `MessageSignals` (Task 7); `DimensionSpec` (Task 1); `IncomingMessage` (Task 6)
- Produces: `createNormalizer(client: AnthropicLike, dimensions: DimensionSpec[]): { normalize(raw: RawObservation[]): Promise<ObservationPayload[]> }`; `createClassifierPipeline(classifier, normalizer): { run(msg: IncomingMessage): Promise<MessageSignals> }`

- [ ] **Step 1: Write the failing test for the normalizer**

```ts
// src/activities/normalizer.test.ts
import { describe, it, expect } from 'vitest';
import { createNormalizer } from './normalizer.js';
import type { AnthropicLike } from './anthropic-like.js';
import { DIMENSIONS } from '../domain/japan-trip.js';

function fakeClient(responseText: string): AnthropicLike {
  return { messages: { create: async () => ({ content: [{ type: 'text', text: responseText }] }) } };
}

describe('createNormalizer', () => {
  it('maps raw observations onto ObservationPayload entries', async () => {
    const json = JSON.stringify([
      { participantId: 'alice', dimensionId: 'airline', value: 'ANA', strength: 'prefer' },
    ]);
    const { normalize } = createNormalizer(fakeClient(json), DIMENSIONS);
    const result = await normalize([{ participantId: 'alice', text: 'I prefer ANA' }]);
    expect(result).toEqual([{ scope: 'participant-objective', participantId: 'alice', dimensionId: 'airline', value: 'ANA', strength: 'prefer' }]);
  });

  it('returns an empty array without calling the model for no observations', async () => {
    let called = false;
    const client: AnthropicLike = { messages: { create: async () => { called = true; return { content: [] }; } } };
    const { normalize } = createNormalizer(client, DIMENSIONS);
    const result = await normalize([]);
    expect(result).toEqual([]);
    expect(called).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/activities/normalizer.test.ts`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement `src/activities/normalizer.ts`**

```ts
import type { AnthropicLike } from './anthropic-like.js';
import { callClaudeText, extractJsonArray } from './anthropic-like.js';
import type { RawObservation, ObservationPayload, Strength } from '../core/classification/types.js';
import type { DimensionSpec } from '../core/comparators/types.js';

export function createNormalizer(client: AnthropicLike, dimensions: DimensionSpec[]) {
  async function normalize(raw: RawObservation[]): Promise<ObservationPayload[]> {
    if (raw.length === 0) return [];

    const dimList = dimensions.map((d) => `- ${d.id}: ${d.label}`).join('\n');
    const prompt = `Map each stated observation onto one of these decision dimensions:
${dimList}

For each observation below, output ONLY a JSON array of objects shaped:
{ "participantId": string, "dimensionId": string, "value": <dimension-appropriate value>, "strength": "lean" | "prefer" | "insist" }

Value formats:
- "dates": { "min": <epoch ms UTC midnight of start date>, "max": <epoch ms UTC midnight of end date> }
- "budget": { "min": <number>, "max": <number> } (per-person USD)
- "places": array of exactly 3 place name strings
- "airline": a single airline name string

If an observation doesn't map to any dimension, omit it.

Observations:
${JSON.stringify(raw)}`;

    const text = await callClaudeText(client, prompt);
    const items = JSON.parse(extractJsonArray(text)) as {
      participantId: string;
      dimensionId: string;
      value: unknown;
      strength: Strength;
    }[];

    return items.map((item) => ({
      scope: 'participant-objective' as const,
      participantId: item.participantId,
      dimensionId: item.dimensionId,
      value: item.value,
      strength: item.strength,
    }));
  }

  return { normalize };
}
```

- [ ] **Step 4: Run normalizer test to verify it passes**

Run: `npx vitest run src/activities/normalizer.test.ts`
Expected: PASS (2 tests)

- [ ] **Step 5: Write the failing test for ClassifierPipeline**

```ts
// src/activities/classifier-pipeline.test.ts
import { describe, it, expect } from 'vitest';
import { createClassifierPipeline } from './classifier-pipeline.js';
import type { IncomingMessage } from '../core/events/types.js';
import type { ClassifierOutput } from '../core/classification/types.js';

const msg: IncomingMessage = { id: 'm1', sessionId: 's1', speakerId: 'alice', speakerRole: 'human', text: 'I prefer ANA', ts: 1, mentions: [] };

describe('createClassifierPipeline', () => {
  it('composes classify then normalize into MessageSignals', async () => {
    const classifierOutput: ClassifierOutput = {
      addressee: { value: { kind: 'group' }, confidence: 0.8 },
      actionability: { value: { kind: 'deliberation' }, confidence: 0.8 },
      observations: { value: [{ participantId: 'alice', text: 'I prefer ANA' }], confidence: 0.8 },
    };
    const classifier = { classify: async () => classifierOutput };
    const normalizer = {
      normalize: async () => [{ scope: 'participant-objective' as const, participantId: 'alice', dimensionId: 'airline', value: 'ANA', strength: 'prefer' as const }],
    };
    const { run } = createClassifierPipeline(classifier, normalizer);
    const signals = await run(msg);
    expect(signals.addressee).toEqual(classifierOutput.addressee);
    expect(signals.observations.value).toEqual([
      { scope: 'participant-objective', participantId: 'alice', dimensionId: 'airline', value: 'ANA', strength: 'prefer' },
    ]);
  });
});
```

- [ ] **Step 6: Run test to verify it fails**

Run: `npx vitest run src/activities/classifier-pipeline.test.ts`
Expected: FAIL — module does not exist.

- [ ] **Step 7: Implement `src/activities/classifier-pipeline.ts`**

```ts
import type { IncomingMessage } from '../core/events/types.js';
import type { ClassifierOutput, MessageSignals, ObservationPayload, RawObservation } from '../core/classification/types.js';

export interface ClassifierLike {
  classify(msg: IncomingMessage): Promise<ClassifierOutput>;
}

export interface NormalizerLike {
  normalize(raw: RawObservation[]): Promise<ObservationPayload[]>;
}

export function createClassifierPipeline(classifier: ClassifierLike, normalizer: NormalizerLike) {
  async function run(msg: IncomingMessage): Promise<MessageSignals> {
    const c = await classifier.classify(msg);
    const observations = await normalizer.normalize(c.observations.value);
    return {
      addressee: c.addressee,
      actionability: c.actionability,
      observations: { value: observations, confidence: c.observations.confidence },
    };
  }

  return { run };
}
```

- [ ] **Step 8: Run test to verify it passes**

Run: `npx vitest run src/activities/classifier-pipeline.test.ts`
Expected: PASS (1 test)

- [ ] **Step 9: Commit**

```bash
git add src/activities/normalizer.ts src/activities/normalizer.test.ts src/activities/classifier-pipeline.ts src/activities/classifier-pipeline.test.ts
git commit -m "feat: Claude-backed normalizer and classifier pipeline"
```

---

### Task 13: Agent-invocation activity (reactive + proactive + mock KB validation)

**Files:**
- Create: `src/activities/agent-invocation.ts`
- Test: `src/activities/agent-invocation.test.ts`

**Interfaces:**
- Consumes: `AnthropicLike`, `callClaudeText` (Task 11); `IncomingMessage`, `MessageSignals` (Task 6/7); `FacilitationTrigger` (Task 9); `estimateTripCostPerPerson` (Task 4); `Range` (Task 1)
- Produces: `createAgentInvoker(client: AnthropicLike): { invokeReactiveAgent(req): Promise<{text}>; invokeProactiveAgent(req): Promise<{text, feasible}> }`

- [ ] **Step 1: Write the failing test**

```ts
// src/activities/agent-invocation.test.ts
import { describe, it, expect } from 'vitest';
import { createAgentInvoker } from './agent-invocation.js';
import type { AnthropicLike } from './anthropic-like.js';
import type { IncomingMessage } from '../core/events/types.js';
import type { MessageSignals } from '../core/classification/types.js';

function fakeClient(responseText: string): AnthropicLike {
  return { messages: { create: async () => ({ content: [{ type: 'text', text: responseText }] }) } };
}

const msg: IncomingMessage = { id: 'm1', sessionId: 's1', speakerId: 'alice', speakerRole: 'human', text: 'what do you think?', ts: 1, mentions: [] };
const signals: MessageSignals = {
  addressee: { value: { kind: 'agent' }, confidence: 0.9 },
  actionability: { value: { kind: 'question' }, confidence: 0.9 },
  observations: { value: [], confidence: 0.9 },
};

describe('createAgentInvoker', () => {
  it('invokes the reactive path and returns the model text', async () => {
    const { invokeReactiveAgent } = createAgentInvoker(fakeClient('Sounds like a great plan!'));
    const result = await invokeReactiveAgent({ msg, signals, expectedVersion: 0 });
    expect(result.text).toBe('Sounds like a great plan!');
  });

  it('reports feasible=true and finalizes when the aligned choice fits the budget', async () => {
    const { invokeProactiveAgent } = createAgentInvoker(fakeClient('Your trip is set!'));
    const result = await invokeProactiveAgent({
      trigger: {
        kind: 'alignment-reached',
        summary: 'aligned',
        values: {
          dates: { min: Date.UTC(2026, 2, 1), max: Date.UTC(2026, 2, 8) },
          budget: { min: 1000, max: 5000 },
          places: ['Osaka', 'Hiroshima', 'Kyoto'],
          airline: 'United',
        },
      },
      expectedVersion: 0,
    });
    expect(result.feasible).toBe(true);
    expect(result.text).toBe('Your trip is set!');
  });

  it('reports feasible=false when the aligned choice exceeds the budget', async () => {
    const { invokeProactiveAgent } = createAgentInvoker(fakeClient('That is over budget.'));
    const result = await invokeProactiveAgent({
      trigger: {
        kind: 'alignment-reached',
        summary: 'aligned',
        values: {
          dates: { min: Date.UTC(2026, 11, 20), max: Date.UTC(2026, 11, 30) },
          budget: { min: 100, max: 200 },
          places: ['Hokkaido', 'Tokyo', 'Kyoto'],
          airline: 'JAL',
        },
      },
      expectedVersion: 0,
    });
    expect(result.feasible).toBe(false);
  });

  it('handles a conflict-detected trigger without calling the KB feasibility check', async () => {
    const { invokeProactiveAgent } = createAgentInvoker(fakeClient('unused'));
    const result = await invokeProactiveAgent({
      trigger: { kind: 'conflict-detected', between: ['alice', 'bob'], on: 'airline', detail: 'Competing insist positions: ANA, JAL' },
      expectedVersion: 0,
    });
    expect(result.feasible).toBe(false);
    expect(result.text).toMatch(/airline/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/activities/agent-invocation.test.ts`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement `src/activities/agent-invocation.ts`**

```ts
import type { AnthropicLike } from './anthropic-like.js';
import { callClaudeText } from './anthropic-like.js';
import type { IncomingMessage } from '../core/events/types.js';
import type { MessageSignals } from '../core/classification/types.js';
import type { FacilitationTrigger } from '../core/facilitation/types.js';
import { estimateTripCostPerPerson } from '../domain/japan-trip.js';
import type { Range } from '../core/comparators/range.js';

export interface ReactiveRequest {
  msg: IncomingMessage;
  signals: MessageSignals;
  expectedVersion: number;
}

export interface ProactiveRequest {
  trigger: FacilitationTrigger;
  expectedVersion: number;
}

interface AlignedValues {
  dates: Range;
  budget: Range;
  places: string[];
  airline: string;
}

export function createAgentInvoker(client: AnthropicLike) {
  async function invokeReactiveAgent(req: ReactiveRequest): Promise<{ text: string }> {
    const prompt = `You are a helpful trip-planning assistant in a group chat about a trip to Japan. A participant said: "${req.msg.text}". Respond helpfully and briefly (2-3 sentences).`;
    return { text: await callClaudeText(client, prompt, 512) };
  }

  async function invokeProactiveAgent(req: ProactiveRequest): Promise<{ text: string; feasible: boolean }> {
    if (req.trigger.kind === 'conflict-detected') {
      const text = `Looks like there's a disagreement on ${req.trigger.on}: ${req.trigger.detail}. Want to work that out?`;
      return { text, feasible: false };
    }
    if (req.trigger.kind !== 'alignment-reached') {
      throw new Error(`Unsupported proactive trigger kind: ${req.trigger.kind}`);
    }

    const values = req.trigger.values as unknown as AlignedValues;
    const costPerPerson = estimateTripCostPerPerson(values.places, values.airline, values.dates);
    const feasible = costPerPerson <= values.budget.max;

    const prompt = feasible
      ? `The group aligned on: dates ${JSON.stringify(values.dates)}, budget ${JSON.stringify(values.budget)}, places ${values.places.join(', ')}, airline ${values.airline}. Estimated cost per person: $${costPerPerson}. Write a short, upbeat finalized itinerary message summarizing all of this for the group.`
      : `The group aligned on: dates ${JSON.stringify(values.dates)}, budget ${JSON.stringify(values.budget)}, places ${values.places.join(', ')}, airline ${values.airline}. Estimated cost per person is $${costPerPerson}, which exceeds their budget of $${values.budget.max}. Write a short message explaining the shortfall and suggesting they adjust the airline or drop a destination.`;

    return { text: await callClaudeText(client, prompt, 512), feasible };
  }

  return { invokeReactiveAgent, invokeProactiveAgent };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/activities/agent-invocation.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add src/activities/agent-invocation.ts src/activities/agent-invocation.test.ts
git commit -m "feat: reactive and proactive agent-invocation activity with mock KB validation"
```

---

### Task 14: Broadcast registry + activities index

**Files:**
- Create: `src/activities/broadcast.ts`
- Create: `src/activities/index.ts`
- Test: `src/activities/broadcast.test.ts`

**Interfaces:**
- Consumes: `SessionEvent` (Task 6)
- Produces: `registerSocket(sessionId: string, socket: WsLike): void`, `broadcastEvents(sessionId: string, events: SessionEvent[]): Promise<void>` (both use a minimal `WsLike` interface for testability); `src/activities/index.ts` aggregating all activity functions for Temporal's `Worker`

- [ ] **Step 1: Write the failing test**

```ts
// src/activities/broadcast.test.ts
import { describe, it, expect, vi } from 'vitest';
import { registerSocket, broadcastEvents } from './broadcast.js';
import type { SessionEvent } from '../core/events/types.js';

function fakeSocket() {
  const sent: string[] = [];
  const listeners: Record<string, (() => void)[]> = {};
  return {
    readyState: 1,
    send: (data: string) => sent.push(data),
    on: (event: string, cb: () => void) => {
      (listeners[event] ??= []).push(cb);
    },
    triggerClose: () => listeners.close?.forEach((cb) => cb()),
    sent,
  };
}

const event: SessionEvent = { seq: 1, sessionId: 's1', type: 'MessagePosted', actor: { kind: 'system' }, payload: {}, ts: 1 };

describe('broadcast registry', () => {
  it('sends events to every socket registered for a session', async () => {
    const socket = fakeSocket();
    registerSocket('s1', socket as any);
    await broadcastEvents('s1', [event]);
    expect(socket.sent).toHaveLength(1);
    expect(JSON.parse(socket.sent[0])).toEqual({ type: 'events', events: [event] });
  });

  it('does not send to sockets after they close', async () => {
    const socket = fakeSocket();
    registerSocket('s2', socket as any);
    socket.triggerClose();
    await broadcastEvents('s2', [event]);
    expect(socket.sent).toHaveLength(0);
  });

  it('is a no-op for a session with no registered sockets', async () => {
    await expect(broadcastEvents('unknown-session', [event])).resolves.toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/activities/broadcast.test.ts`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement `src/activities/broadcast.ts`**

```ts
import type { SessionEvent } from '../core/events/types.js';

// `ws`'s WebSocket exposes readyState as an instance property, but the OPEN
// constant is only reliably typed as static — so we compare against the
// literal value (1) rather than depending on an instance-level OPEN member.
const WS_OPEN = 1;

export interface WsLike {
  readyState: number;
  send(data: string): void;
  on(event: 'close', cb: () => void): void;
}

const sessionSockets = new Map<string, Set<WsLike>>();

export function registerSocket(sessionId: string, socket: WsLike): void {
  const set = sessionSockets.get(sessionId) ?? new Set<WsLike>();
  set.add(socket);
  sessionSockets.set(sessionId, set);
  socket.on('close', () => set.delete(socket));
}

export async function broadcastEvents(sessionId: string, events: SessionEvent[]): Promise<void> {
  const set = sessionSockets.get(sessionId);
  if (!set) return;
  const payload = JSON.stringify({ type: 'events', events });
  for (const socket of set) {
    if (socket.readyState === WS_OPEN) socket.send(payload);
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/activities/broadcast.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 5: Implement `src/activities/index.ts`** (no test — pure wiring, exercised by Task 15's workflow integration test)

```ts
import Anthropic from '@anthropic-ai/sdk';
import { createClassifier } from './classifier.js';
import { createNormalizer } from './normalizer.js';
import { createAgentInvoker } from './agent-invocation.js';
import { DIMENSIONS } from '../domain/japan-trip.js';

const client = new Anthropic();

export const { classify } = createClassifier(client);
export const { normalize } = createNormalizer(client, DIMENSIONS);
export const { invokeReactiveAgent, invokeProactiveAgent } = createAgentInvoker(client);
export { broadcastEvents, registerSocket } from './broadcast.js';
```

- [ ] **Step 6: Run the full test suite to confirm nothing broke**

Run: `npx vitest run`
Expected: PASS — all tests from Tasks 1-14 pass.

- [ ] **Step 7: Commit**

```bash
git add src/activities/broadcast.ts src/activities/broadcast.test.ts src/activities/index.ts
git commit -m "feat: in-process broadcast registry and activities index"
```

---

### Task 15: Session workflow (orchestration + in-memory event log)

**Files:**
- Create: `src/workflows/session.workflow.ts`
- Test: `src/workflows/session.workflow.test.ts`

**Interfaces:**
- Consumes: everything from Tasks 1-14 (`RuleBasedRoutingPolicy`, `toObservationEvents`, `ProjectionRegistry`, `objectiveModelProjection`, `canonicalProjection`, `presenceProjection`, `AlignmentDetectorImpl`, `RuleBasedFacilitationGate`, `facilitationKey`, `DIMENSIONS`, and the activity functions via `proxyActivities`)
- Produces: `sessionWorkflow(sessionId: string): Promise<void>`, signals `submitMessageSignal`, `joinSignal`, `leaveSignal`, query `getStateQuery` returning `SessionState { events, objectiveModel, canonical, presence, dimensionStatus }`

- [ ] **Step 1: Implement `src/workflows/session.workflow.ts`**

```ts
import { defineSignal, defineQuery, setHandler, proxyActivities, condition } from '@temporalio/workflow';
import type * as activities from '../activities/index.js';
import type { SessionEvent } from '../core/events/types.js';
import type { IncomingMessage } from '../core/events/types.js';
import { RuleBasedRoutingPolicy } from '../core/routing/policy.js';
import { toObservationEvents } from '../core/events/to-observation-events.js';
import { ProjectionRegistry } from '../core/projections/registry.js';
import { objectiveModelProjection, reconcileAllDimensions, type ObjectiveModelState } from '../core/projections/objective-model.js';
import { canonicalProjection, type CanonicalState } from '../core/projections/canonical.js';
import { presenceProjection, presentParticipantIds, type PresenceState } from '../core/projections/presence.js';
import { AlignmentDetectorImpl } from '../core/facilitation/detector.js';
import { RuleBasedFacilitationGate, facilitationKey } from '../core/facilitation/gate.js';
import type { Reconciliation } from '../core/comparators/types.js';
import { DIMENSIONS } from '../domain/japan-trip.js';

const { classify, normalize, invokeReactiveAgent, invokeProactiveAgent, broadcastEvents } = proxyActivities<typeof activities>({
  startToCloseTimeout: '30 seconds',
});

export const submitMessageSignal = defineSignal<[IncomingMessage]>('submitMessage');
export const joinSignal = defineSignal<[{ participantId: string; displayName: string }]>('join');
export const leaveSignal = defineSignal<[{ participantId: string }]>('leave');

export interface SessionState {
  events: SessionEvent[];
  objectiveModel: ObjectiveModelState;
  canonical: CanonicalState;
  presence: PresenceState;
  dimensionStatus: Record<string, Reconciliation>;
}

export const getStateQuery = defineQuery<SessionState>('getState');

export async function sessionWorkflow(sessionId: string): Promise<void> {
  const events: SessionEvent[] = [];
  let nextSeqValue = 0;
  const nextSeq = () => ++nextSeqValue;

  const registry = new ProjectionRegistry([objectiveModelProjection, canonicalProjection, presenceProjection]);
  const policy = new RuleBasedRoutingPolicy();
  const detector = new AlignmentDetectorImpl(DIMENSIONS);
  const gate = new RuleBasedFacilitationGate();
  const recentFacilitations: { kind: string; at: number }[] = [];

  function emit(newEvents: SessionEvent[]) {
    for (const e of newEvents) {
      events.push(e);
      registry.apply(e);
    }
    if (newEvents.length > 0) void broadcastEvents(sessionId, newEvents);
  }

  function currentDimensionStatus(): Record<string, Reconciliation> {
    const model = registry.get<ObjectiveModelState>('objective-model');
    const presence = registry.get<PresenceState>('presence');
    const map = reconcileAllDimensions(model, presentParticipantIds(presence), DIMENSIONS);
    return Object.fromEntries(map);
  }

  setHandler(joinSignal, ({ participantId, displayName }) => {
    emit([{ seq: nextSeq(), sessionId, type: 'ParticipantJoined', actor: { kind: 'system' }, payload: { participantId, displayName }, ts: Date.now() }]);
  });

  setHandler(leaveSignal, ({ participantId }) => {
    emit([{ seq: nextSeq(), sessionId, type: 'ParticipantLeft', actor: { kind: 'system' }, payload: { participantId }, ts: Date.now() }]);
  });

  setHandler(getStateQuery, () => ({
    events,
    objectiveModel: registry.get<ObjectiveModelState>('objective-model'),
    canonical: registry.get<CanonicalState>('canonical'),
    presence: registry.get<PresenceState>('presence'),
    dimensionStatus: currentDimensionStatus(),
  }));

  setHandler(submitMessageSignal, async (msg: IncomingMessage) => {
    const classifierOutput = await classify(msg);
    const observations = await normalize(classifierOutput.observations.value);
    const signals = {
      addressee: classifierOutput.addressee,
      actionability: classifierOutput.actionability,
      observations: { value: observations, confidence: classifierOutput.observations.confidence },
    };

    const decision = policy.decide(signals, { sessionId, presence: registry.get<PresenceState>('presence') });

    emit([{ seq: nextSeq(), sessionId, type: 'MessagePosted', actor: { kind: 'human', participantId: msg.speakerId }, payload: msg, ts: msg.ts }]);

    if (decision.applyObservations) {
      emit(toObservationEvents(msg, signals, nextSeq));
    }

    let reactiveInvoked = false;
    if (decision.invokeAgent) {
      const result = await invokeReactiveAgent({ msg, signals, expectedVersion: registry.getVersion('canonical') });
      reactiveInvoked = true;
      emit([
        {
          seq: nextSeq(),
          sessionId,
          type: 'AgentMessagePosted',
          actor: { kind: 'agent', agentId: 'assistant', triggeredBy: { kind: 'human', participantId: msg.speakerId } },
          payload: { text: result.text },
          ts: Date.now(),
        },
      ]);
    }

    const triggers = detector.evaluate(registry.get<ObjectiveModelState>('objective-model'), registry.get<PresenceState>('presence'));
    const turn = { reactiveInvoked, lastActionability: signals.actionability.value, recentFacilitations };

    for (const trigger of triggers) {
      const outcome = gate.admit(trigger, turn, Date.now());
      if (outcome.action === 'surface') {
        recentFacilitations.push({ kind: facilitationKey(trigger), at: Date.now() });
        const result = await invokeProactiveAgent({ trigger, expectedVersion: registry.getVersion('canonical') });
        emit([
          {
            seq: nextSeq(),
            sessionId,
            type: 'AgentMessagePosted',
            actor: { kind: 'agent', agentId: 'assistant', triggeredBy: { kind: 'system' } },
            payload: { text: result.text },
            ts: Date.now(),
          },
        ]);
        if (trigger.kind === 'alignment-reached' && result.feasible) {
          const ratifyEvents = Object.entries(trigger.values).map(([dimensionId, value]) => ({
            seq: nextSeq(),
            sessionId,
            type: 'DecisionRatified',
            actor: { kind: 'agent' as const, agentId: 'assistant', triggeredBy: { kind: 'system' as const } },
            payload: { dimensionId, value },
            ts: Date.now(),
          }));
          emit(ratifyEvents);
        }
      }
      // 'fold' and 'suppress' both mean: do nothing further this tick.
    }
  });

  await condition(() => false);
}
```

Note: `workflowsPath` is a filesystem path Temporal's own bundler resolves directly (it webpack-bundles the workflow file itself, independent of how the outer script is run) — since this project has no compile-to-`dist` step and runs via `tsx`, that path must point at the `.ts` source file on disk, not a `.js` module specifier. This is different from the `.js`-suffixed import specifiers used elsewhere in this file, which are ordinary NodeNext ESM imports that TypeScript resolves to the `.ts` source.

- [ ] **Step 2: Write the workflow integration test using `TestWorkflowEnvironment`**

```ts
// src/workflows/session.workflow.test.ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { TestWorkflowEnvironment } from '@temporalio/testing';
import { Worker } from '@temporalio/worker';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { sessionWorkflow, submitMessageSignal, joinSignal, getStateQuery } from './session.workflow.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

describe('sessionWorkflow', () => {
  let env: TestWorkflowEnvironment;

  beforeAll(async () => {
    env = await TestWorkflowEnvironment.createLocal();
  }, 30_000);

  afterAll(async () => {
    await env?.teardown();
  });

  it('records a message and invokes the reactive agent when directly addressed', async () => {
    const taskQueue = 'test-session-tasks';
    const mockActivities = {
      classify: async () => ({
        addressee: { value: { kind: 'agent' }, confidence: 0.95 },
        actionability: { value: { kind: 'question' }, confidence: 0.9 },
        observations: { value: [], confidence: 0.9 },
      }),
      normalize: async () => [],
      invokeReactiveAgent: async () => ({ text: 'Sure, happy to help!' }),
      invokeProactiveAgent: async () => ({ text: 'unused', feasible: false }),
      broadcastEvents: async () => {},
    };

    const worker = await Worker.create({
      connection: env.nativeConnection,
      taskQueue,
      workflowsPath: path.join(__dirname, 'session.workflow.ts'),
      activities: mockActivities,
    });

    await worker.runUntil(async () => {
      const handle = await env.client.workflow.start(sessionWorkflow, {
        workflowId: 'test-session-1',
        taskQueue,
        args: ['test-session-1'],
      });

      await handle.signal(joinSignal, { participantId: 'alice', displayName: 'Alice' });
      await handle.signal(submitMessageSignal, {
        id: 'm1',
        sessionId: 'test-session-1',
        speakerId: 'alice',
        speakerRole: 'human',
        text: 'hey agent, what do you think?',
        ts: Date.now(),
        mentions: [],
      });

      // Give the async signal handler a moment to run within the test environment.
      await new Promise((resolve) => setTimeout(resolve, 500));

      const state = await handle.query(getStateQuery);
      expect(state.events.some((e) => e.type === 'MessagePosted')).toBe(true);
      expect(state.events.some((e) => e.type === 'AgentMessagePosted')).toBe(true);

      await handle.terminate();
    });
  }, 30_000);
});
```

- [ ] **Step 3: Run the test**

Run: `npx vitest run src/workflows/session.workflow.test.ts`
Expected: PASS (1 test). If it fails with a workflow-bundling error mentioning a non-deterministic import, check that `src/core/**` and `src/domain/**` contain no direct `Date.now()`/`Math.random()` calls — all "current time" values must come from function parameters (as designed in Tasks 9-10).

- [ ] **Step 4: Commit**

```bash
git add src/workflows/session.workflow.ts src/workflows/session.workflow.test.ts
git commit -m "feat: session workflow orchestration with in-memory event log"
```

---

### Task 16: Gateway WebSocket server

**Files:**
- Create: `src/gateway/server.ts`

**Interfaces:**
- Consumes: `Client` from `@temporalio/client`, `sessionWorkflow`, `submitMessageSignal`, `joinSignal`, `leaveSignal`, `getStateQuery` (Task 15), `registerSocket` (Task 14)
- Produces: `startGateway(port: number, client: Client): Promise<WebSocketServer>`

No dedicated unit test for this task — it's thin I/O wiring over already-tested pieces (Client, WebSocketServer, and the workflow signals/queries are each tested elsewhere). It's exercised end-to-end in Task 21's manual verification.

- [ ] **Step 1: Implement `src/gateway/server.ts`**

```ts
import { WebSocketServer, type WebSocket } from 'ws';
import type { Client } from '@temporalio/client';
import { randomUUID } from 'node:crypto';
import { sessionWorkflow, submitMessageSignal, joinSignal, leaveSignal, getStateQuery } from '../workflows/session.workflow.js';
import { registerSocket } from '../activities/broadcast.js';

const TASK_QUEUE = 'session-tasks';

export async function startGateway(port: number, client: Client): Promise<WebSocketServer> {
  const wss = new WebSocketServer({ port });

  wss.on('connection', (socket: WebSocket) => {
    let sessionId: string | undefined;
    let participantId: string | undefined;

    socket.on('message', async (raw: Buffer) => {
      const msg = JSON.parse(raw.toString());

      if (msg.type === 'join') {
        sessionId = msg.sessionId;
        participantId = msg.participantId ?? randomUUID();
        registerSocket(sessionId!, socket);

        const handle = client.workflow.getHandle(sessionId!);
        try {
          await handle.describe();
        } catch {
          await client.workflow.start(sessionWorkflow, { workflowId: sessionId!, taskQueue: TASK_QUEUE, args: [sessionId!] });
        }

        const freshHandle = client.workflow.getHandle(sessionId!);
        await freshHandle.signal(joinSignal, { participantId: participantId!, displayName: msg.displayName });
        const state = await freshHandle.query(getStateQuery);
        socket.send(JSON.stringify({ type: 'hydrate', participantId, state }));
        return;
      }

      if (msg.type === 'message' && sessionId && participantId) {
        const handle = client.workflow.getHandle(sessionId);
        await handle.signal(submitMessageSignal, {
          id: randomUUID(),
          sessionId,
          speakerId: participantId,
          speakerRole: 'human' as const,
          text: msg.text,
          ts: Date.now(),
          mentions: [],
        });
      }
    });

    socket.on('close', async () => {
      if (sessionId && participantId) {
        const handle = client.workflow.getHandle(sessionId);
        await handle.signal(leaveSignal, { participantId });
      }
    });
  });

  console.log(`Gateway listening on ws://localhost:${port}`);
  return wss;
}
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/gateway/server.ts
git commit -m "feat: WebSocket gateway wired to the Temporal client"
```

---

### Task 17: Dev bootstrap script

**Files:**
- Create: `src/scripts/dev.ts`

**Interfaces:**
- Consumes: `TestWorkflowEnvironment` (`@temporalio/testing`), `Worker` (`@temporalio/worker`), `startGateway` (Task 16), `* as activities` (Task 14)
- Produces: the `npm run dev` entry point

No dedicated unit test — this is a process bootstrap script, verified by Task 21's manual run.

- [ ] **Step 1: Implement `src/scripts/dev.ts`**

```ts
import { TestWorkflowEnvironment } from '@temporalio/testing';
import { Worker } from '@temporalio/worker';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { startGateway } from '../gateway/server.js';
import * as activities from '../activities/index.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function main() {
  console.log('Starting ephemeral Temporal server...');
  const env = await TestWorkflowEnvironment.createLocal();

  const worker = await Worker.create({
    connection: env.nativeConnection,
    taskQueue: 'session-tasks',
    workflowsPath: path.join(__dirname, '../workflows/session.workflow.ts'),
    activities,
  });
  const workerRun = worker.run();

  await startGateway(8080, env.client);
  console.log('Ready: gateway on ws://localhost:8080, Temporal worker running.');

  const shutdown = async () => {
    console.log('Shutting down...');
    worker.shutdown();
    await workerRun;
    await env.teardown();
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
```

- [ ] **Step 2: Run it**

Run: `npm run dev`
Expected: prints "Starting ephemeral Temporal server...", then "Gateway listening on ws://localhost:8080", then "Ready: gateway on ws://localhost:8080, Temporal worker running." Leave it running for Task 21. Ctrl-C should cleanly shut down.

- [ ] **Step 3: Commit**

```bash
git add src/scripts/dev.ts
git commit -m "feat: single-command dev bootstrap (ephemeral Temporal + worker + gateway)"
```

---

### Task 18: React client scaffold + join screen + WebSocket hook

**Files:**
- Create: `client/package.json`
- Create: `client/vite.config.ts`
- Create: `client/tsconfig.json`
- Create: `client/index.html`
- Create: `client/src/main.tsx`
- Create: `client/src/useSession.ts`
- Create: `client/src/JoinScreen.tsx`

**Interfaces:**
- Produces: `useSession(): { state, participantId, connected, join(sessionId, displayName), sendMessage(text) }`; `<JoinScreen onJoin={(sessionId, displayName) => void} />`

No unit test for this task — this is UI wiring, verified visually/manually in Task 21. The client intentionally has no business logic to unit test: all reconciliation/status data is computed server-side (Task 15's `dimensionStatus`) and just rendered here.

- [ ] **Step 1: Create `client/package.json`**

```json
{
  "name": "client",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc && vite build"
  },
  "dependencies": {
    "react": "^18.3.0",
    "react-dom": "^18.3.0"
  },
  "devDependencies": {
    "@types/react": "^18.3.0",
    "@types/react-dom": "^18.3.0",
    "@vitejs/plugin-react": "^4.3.0",
    "typescript": "^5.6.0",
    "vite": "^5.4.0"
  }
}
```

- [ ] **Step 2: Create `client/vite.config.ts`**

```ts
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: { port: 5173 },
});
```

- [ ] **Step 3: Create `client/tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "jsx": "react-jsx",
    "strict": true,
    "skipLibCheck": true
  },
  "include": ["src"]
}
```

- [ ] **Step 4: Create `client/index.html`**

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <title>Multiplayer Agent Chat</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

- [ ] **Step 5: Create `client/src/useSession.ts`**

```ts
import { useCallback, useRef, useState } from 'react';

export interface ChatEvent {
  seq: number;
  type: string;
  actor: { kind: string; participantId?: string; agentId?: string };
  payload: unknown;
  ts: number;
}

export interface SessionState {
  events: ChatEvent[];
  objectiveModel: unknown;
  canonical: unknown;
  presence: { participants: Record<string, { displayName: string; connected: boolean; joinedAt: number }> };
  dimensionStatus: Record<string, { status: string; value?: unknown; between?: string[]; detail?: string; reason?: string }>;
}

export function useSession() {
  const [state, setState] = useState<SessionState | null>(null);
  const [participantId, setParticipantId] = useState<string | null>(null);
  const [connected, setConnected] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);

  const join = useCallback((sessionId: string, displayName: string) => {
    const ws = new WebSocket('ws://localhost:8080');
    wsRef.current = ws;

    ws.onopen = () => {
      setConnected(true);
      ws.send(JSON.stringify({ type: 'join', sessionId, displayName }));
    };

    ws.onmessage = (event) => {
      const msg = JSON.parse(event.data);
      if (msg.type === 'hydrate') {
        setParticipantId(msg.participantId);
        setState(normalizeState(msg.state));
      } else if (msg.type === 'events') {
        setState((prev) => (prev ? { ...prev, events: [...prev.events, ...msg.events] } : prev));
      }
    };

    ws.onclose = () => setConnected(false);
  }, []);

  const sendMessage = useCallback((text: string) => {
    wsRef.current?.send(JSON.stringify({ type: 'message', text }));
  }, []);

  return { state, participantId, connected, join, sendMessage };
}

// The wire payload serializes Maps as plain objects via JSON; presence.participants
// arrives as a JSON object, not a Map, so no conversion is needed client-side.
function normalizeState(raw: unknown): SessionState {
  return raw as SessionState;
}
```

- [ ] **Step 6: Create `client/src/JoinScreen.tsx`**

```tsx
import { useState } from 'react';

export function JoinScreen({ onJoin }: { onJoin: (sessionId: string, displayName: string) => void }) {
  const [sessionId, setSessionId] = useState('japan-trip-demo');
  const [displayName, setDisplayName] = useState('');

  return (
    <div style={{ maxWidth: 320, margin: '80px auto', fontFamily: 'sans-serif' }}>
      <h2>Join a session</h2>
      <label>
        Session code
        <input value={sessionId} onChange={(e) => setSessionId(e.target.value)} style={{ display: 'block', width: '100%' }} />
      </label>
      <label>
        Display name
        <input value={displayName} onChange={(e) => setDisplayName(e.target.value)} style={{ display: 'block', width: '100%' }} />
      </label>
      <button disabled={!displayName || !sessionId} onClick={() => onJoin(sessionId, displayName)} style={{ marginTop: 12 }}>
        Join
      </button>
    </div>
  );
}
```

- [ ] **Step 7: Create a placeholder `client/src/main.tsx` (replaced in Task 20)**

```tsx
import { createRoot } from 'react-dom/client';
import { JoinScreen } from './JoinScreen.js';

createRoot(document.getElementById('root')!).render(<JoinScreen onJoin={() => {}} />);
```

- [ ] **Step 8: Install and run the client dev server**

Run: `npm install` (from repo root — the `client` workspace is installed as part of the root install)
Run: `npm run dev --workspace client`
Expected: Vite dev server starts on `http://localhost:5173`, shows the join screen with a session-code input, a display-name input, and a disabled "Join" button until a name is entered.

- [ ] **Step 9: Commit**

```bash
git add client/package.json client/vite.config.ts client/tsconfig.json client/index.html client/src/useSession.ts client/src/JoinScreen.tsx client/src/main.tsx package-lock.json
git commit -m "feat: React client scaffold, join screen, WebSocket session hook"
```

---

### Task 19: Chat pane

**Files:**
- Create: `client/src/ChatPane.tsx`

**Interfaces:**
- Consumes: `ChatEvent`, `SessionState` (Task 18)
- Produces: `<ChatPane events={ChatEvent[]} participantId={string | null} onSend={(text: string) => void} />`

No unit test — presentational component, verified visually in Task 21.

- [ ] **Step 1: Create `client/src/ChatPane.tsx`**

```tsx
import { useState } from 'react';
import type { ChatEvent } from './useSession.js';

function messageText(event: ChatEvent): string | null {
  if (event.type === 'MessagePosted') return (event.payload as { text: string }).text;
  if (event.type === 'AgentMessagePosted') return (event.payload as { text: string }).text;
  return null;
}

function speakerLabel(event: ChatEvent): string {
  if (event.actor.kind === 'agent') return 'Agent';
  return event.actor.participantId ?? 'unknown';
}

export function ChatPane({ events, onSend }: { events: ChatEvent[]; participantId: string | null; onSend: (text: string) => void }) {
  const [draft, setDraft] = useState('');
  const messages = events.filter((e) => messageText(e) !== null);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div style={{ flex: 1, overflowY: 'auto', padding: 12 }}>
        {messages.map((event) => (
          <div
            key={event.seq}
            style={{
              marginBottom: 8,
              padding: 8,
              borderRadius: 6,
              background: event.actor.kind === 'agent' ? '#eef2ff' : '#f4f4f5',
            }}
          >
            <strong>{speakerLabel(event)}: </strong>
            {messageText(event)}
          </div>
        ))}
      </div>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (!draft.trim()) return;
          onSend(draft);
          setDraft('');
        }}
        style={{ display: 'flex', gap: 8, padding: 12, borderTop: '1px solid #ddd' }}
      >
        <input value={draft} onChange={(e) => setDraft(e.target.value)} style={{ flex: 1 }} placeholder="Say something..." />
        <button type="submit">Send</button>
      </form>
    </div>
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit -p client/tsconfig.json`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add client/src/ChatPane.tsx
git commit -m "feat: chat pane component"
```

---

### Task 20: Alignment sidebar + presence list + App wiring

**Files:**
- Create: `client/src/AlignmentSidebar.tsx`
- Create: `client/src/PresenceList.tsx`
- Create: `client/src/App.tsx`
- Modify: `client/src/main.tsx`

**Interfaces:**
- Consumes: `SessionState` (Task 18), `JoinScreen` (Task 18), `ChatPane` (Task 19)
- Produces: `<App />` as the root component

No unit test — presentational wiring, verified visually in Task 21.

- [ ] **Step 1: Create `client/src/AlignmentSidebar.tsx`**

```tsx
import type { SessionState } from './useSession.js';

const DIMENSION_LABELS: Record<string, string> = {
  dates: 'Travel dates',
  budget: 'Per-person budget',
  places: 'Top 3 places',
  airline: 'Airline',
};

function badgeColor(status: string): string {
  if (status === 'aligned') return '#16a34a';
  if (status === 'conflict') return '#dc2626';
  return '#6b7280';
}

export function AlignmentSidebar({ objectiveModel, dimensionStatus, presence }: {
  objectiveModel: SessionState['objectiveModel'];
  dimensionStatus: SessionState['dimensionStatus'];
  presence: SessionState['presence'];
}) {
  const model = objectiveModel as { dimensions: Record<string, Record<string, { value: unknown; strength: string }>> };
  const participantIds = Object.keys(presence.participants);

  return (
    <div style={{ padding: 12, borderLeft: '1px solid #ddd', width: 280 }}>
      <h3>Alignment</h3>
      {Object.entries(DIMENSION_LABELS).map(([dimId, label]) => {
        const status = dimensionStatus[dimId];
        const positions = model.dimensions?.[dimId] ?? {};
        return (
          <div key={dimId} style={{ marginBottom: 12 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <strong>{label}</strong>
              <span style={{ color: badgeColor(status?.status ?? 'open'), fontSize: 12 }}>{status?.status ?? 'open'}</span>
            </div>
            {participantIds.map((id) => {
              const pos = positions[id];
              return (
                <div key={id} style={{ fontSize: 12, color: '#555' }}>
                  {id}: {pos ? `${JSON.stringify(pos.value)} (${pos.strength})` : '—'}
                </div>
              );
            })}
          </div>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 2: Create `client/src/PresenceList.tsx`**

```tsx
import type { SessionState } from './useSession.js';

export function PresenceList({ presence }: { presence: SessionState['presence'] }) {
  const entries = Object.entries(presence.participants);
  return (
    <div style={{ padding: '8px 12px', borderBottom: '1px solid #ddd', fontSize: 13 }}>
      {entries.map(([id, p]) => (
        <span key={id} style={{ marginRight: 12, opacity: p.connected ? 1 : 0.4 }}>
          {p.displayName}
        </span>
      ))}
    </div>
  );
}
```

- [ ] **Step 3: Create `client/src/App.tsx`**

```tsx
import { useSession } from './useSession.js';
import { JoinScreen } from './JoinScreen.js';
import { ChatPane } from './ChatPane.js';
import { AlignmentSidebar } from './AlignmentSidebar.js';
import { PresenceList } from './PresenceList.js';

export function App() {
  const { state, participantId, join, sendMessage } = useSession();

  if (!state) {
    return <JoinScreen onJoin={join} />;
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', fontFamily: 'sans-serif' }}>
      <PresenceList presence={state.presence} />
      <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
        <div style={{ flex: 1 }}>
          <ChatPane events={state.events} participantId={participantId} onSend={sendMessage} />
        </div>
        <AlignmentSidebar objectiveModel={state.objectiveModel} dimensionStatus={state.dimensionStatus} presence={state.presence} />
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Update `client/src/main.tsx`**

```tsx
import { createRoot } from 'react-dom/client';
import { App } from './App.js';

createRoot(document.getElementById('root')!).render(<App />);
```

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit -p client/tsconfig.json`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add client/src/AlignmentSidebar.tsx client/src/PresenceList.tsx client/src/App.tsx client/src/main.tsx
git commit -m "feat: alignment sidebar, presence list, and App wiring"
```

---

### Task 21: End-to-end manual verification

**Files:**
- Create: `docs/superpowers/plans/2026-07-04-manual-verification-checklist.md`

**Interfaces:**
- Consumes: the fully running system from Tasks 1-20
- Produces: a documented, repeatable manual test procedure and a completed checklist

- [ ] **Step 1: Create the manual verification checklist document**

```markdown
# v0 Manual Verification Checklist

## Setup
- [ ] `ANTHROPIC_API_KEY` is set in the environment
- [ ] Run `npm install` at repo root (installs both root and `client` workspace)
- [ ] Terminal 1: `npm run dev` — wait for "Ready: gateway on ws://localhost:8080, Temporal worker running."
- [ ] Terminal 2: `npm run dev --workspace client` — wait for the Vite local URL

## Scripted conversation (3 browser tabs)
- [ ] Tab 1: join session code `japan-trip-demo` as "Alice"
- [ ] Tab 2: join the same session code as "Bob"
- [ ] Tab 3: join the same session code as "Carol"
- [ ] Confirm all 3 names appear in the presence bar in every tab
- [ ] Alice: "I'm thinking dates Dec 20-28, budget around $1500-2500 per person"
- [ ] Bob: "Works for me, same dates and budget"
- [ ] Carol: "Sounds good, I'm flexible on dates and budget too"
- [ ] Confirm the alignment sidebar shows `dates` and `budget` as `aligned` in all 3 tabs once all 3 have stated a position
- [ ] Alice: "I really want to see Tokyo, Kyoto, and Osaka"
- [ ] Bob: "Same, Tokyo Kyoto Osaka works"
- [ ] Carol: "Tokyo, Kyoto, Osaka for me too"
- [ ] Confirm `places` shows `aligned`
- [ ] Alice: "let's fly ANA"
- [ ] Bob: "ANA works"
- [ ] Carol: "ANA for me too"
- [ ] Confirm all 4 dimensions read `aligned`, and within a few seconds the agent posts an unprompted finalized itinerary message (or a pushback message if the mock-KB cost estimate exceeds $2500/person) — **in all 3 tabs**, without anyone explicitly asking the agent to finalize
- [ ] In Tab 1, type "hey agent, what do you think of Osaka?" and confirm a reactive response appears promptly, distinct from the earlier proactive one

## Regression checks
- [ ] A purely social message ("thanks everyone!") does not get an agent response and does not appear in the alignment sidebar as a new position
- [ ] Closing Tab 3 (Carol) updates the presence bar in the remaining tabs to show Carol as disconnected
```

- [ ] **Step 2: Execute the checklist**

Follow the document above end to end, checking off each box, in a real browser against the running `npm run dev` + client dev server.

- [ ] **Step 3: Record results and fix any failing checks**

If any step fails, use `superpowers:systematic-debugging` to investigate before checking it off. Do not mark the checklist complete with unresolved failures.

- [ ] **Step 4: Commit the completed checklist**

```bash
git add docs/superpowers/plans/2026-07-04-manual-verification-checklist.md
git commit -m "docs: v0 manual end-to-end verification checklist"
```
