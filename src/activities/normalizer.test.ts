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
