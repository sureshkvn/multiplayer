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
