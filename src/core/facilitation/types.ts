import type { Actionability } from '../classification/types.js';
import type { ObjectiveModelState } from '../projections/objective-model.js';
import type { PresenceState } from '../projections/presence.js';

export type FacilitationTrigger =
  | { kind: 'alignment-reached'; summary: string; values: Record<string, unknown> }
  | { kind: 'conflict-detected'; between: string[]; on: string; detail: string }
  | { kind: 'stalled'; since: number };
// Note: 'stalled' is part of the type for contract fidelity but is never
// constructed in v0 — implementing it requires cancellable Temporal timers
// that add real complexity with no requirement driving it yet.

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
