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
