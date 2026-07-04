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
