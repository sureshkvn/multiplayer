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
    const decision = policy.decide(
      signals({
        addressee: { value: { kind: 'agent' }, confidence: 0.9 },
        actionability: { value: { kind: 'question' }, confidence: 0.9 },
      }),
      ctx,
    );
    expect(decision.invokeAgent).toBe(true);
    expect(decision.reason).toMatch(/^direct-request:/);
  });

  it('stays silent by default with no matching rule', () => {
    const decision = policy.decide(signals({ actionability: { value: { kind: 'deliberation' }, confidence: 0.9 } }), ctx);
    expect(decision.invokeAgent).toBe(false);
    expect(decision.reason).toMatch(/^deliberation:/);
  });

  it('sets applyObservations=false when the classifier found nothing, even for a deliberation message', () => {
    const decision = policy.decide(signals({ actionability: { value: { kind: 'deliberation' }, confidence: 0.9 } }), ctx);
    expect(decision.applyObservations).toBe(false);
  });

  it('sets applyObservations=true whenever there are extracted observations, even for a socially-toned message', () => {
    // A short, casual affirmation ("me too, works fine") can be classified as
    // 'social' by tone while still carrying a real extracted position — the
    // tone label must not cause that data to be discarded.
    const decision = policy.decide(
      signals({
        actionability: { value: { kind: 'social' }, confidence: 0.8 },
        observations: {
          value: [{ scope: 'participant-objective', participantId: 'bob', dimensionId: 'places', value: ['Tokyo', 'Osaka', 'Kyoto'], strength: 'prefer' }],
          confidence: 1,
        },
      }),
      ctx,
    );
    expect(decision.applyObservations).toBe(true);
  });
});
