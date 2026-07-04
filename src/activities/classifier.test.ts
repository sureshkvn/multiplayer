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
