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
