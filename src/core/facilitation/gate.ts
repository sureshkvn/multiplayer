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
