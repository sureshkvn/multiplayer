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

  it('converts ISO date strings from the model into epoch ms deterministically, not via model arithmetic', async () => {
    const json = JSON.stringify([
      { participantId: 'alice', dimensionId: 'dates', value: { min: '2026-12-20', max: '2026-12-27' }, strength: 'insist' },
    ]);
    const { normalize } = createNormalizer(fakeClient(json), DIMENSIONS);
    const result = await normalize([{ participantId: 'alice', text: 'Dec 20th to Dec 27th' }]);
    expect(result).toEqual([
      {
        scope: 'participant-objective',
        participantId: 'alice',
        dimensionId: 'dates',
        value: { min: Date.UTC(2026, 11, 20), max: Date.UTC(2026, 11, 27) },
        strength: 'insist',
      },
    ]);
  });

  it('includes today\'s date in the prompt so relative years can be resolved', async () => {
    let capturedPrompt = '';
    const client: AnthropicLike = {
      messages: {
        create: async (params) => {
          capturedPrompt = params.messages[0].content;
          return { content: [{ type: 'text', text: '[]' }] };
        },
      },
    };
    const { normalize } = createNormalizer(client, DIMENSIONS);
    await normalize([{ participantId: 'alice', text: 'Dec 20th' }]);
    expect(capturedPrompt).toContain("Today's date is");
  });
});
