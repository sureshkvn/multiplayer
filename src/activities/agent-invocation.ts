import type { AnthropicLike } from './anthropic-like.js';
import { callClaudeText } from './anthropic-like.js';
import type { IncomingMessage } from '../core/events/types.js';
import type { MessageSignals } from '../core/classification/types.js';
import type { FacilitationTrigger } from '../core/facilitation/types.js';
import { estimateTripCostPerPerson } from '../domain/japan-trip.js';
import type { Range } from '../core/comparators/range.js';

export interface ReactiveRequest {
  msg: IncomingMessage;
  signals: MessageSignals;
  expectedVersion: number;
}

export interface ProactiveRequest {
  trigger: FacilitationTrigger;
  expectedVersion: number;
}

interface AlignedValues {
  dates: Range;
  budget: Range;
  places: string[];
  airline: string;
}

export function createAgentInvoker(client: AnthropicLike) {
  async function invokeReactiveAgent(req: ReactiveRequest): Promise<{ text: string }> {
    const prompt = `You are a helpful trip-planning assistant in a group chat about a trip to Japan. A participant said: "${req.msg.text}". Respond helpfully and briefly (2-3 sentences).`;
    return { text: await callClaudeText(client, prompt, 512) };
  }

  async function invokeProactiveAgent(req: ProactiveRequest): Promise<{ text: string; feasible: boolean }> {
    if (req.trigger.kind === 'conflict-detected') {
      const text = `Looks like there's a disagreement on ${req.trigger.on}: ${req.trigger.detail}. Want to work that out?`;
      return { text, feasible: false };
    }
    if (req.trigger.kind !== 'alignment-reached') {
      throw new Error(`Unsupported proactive trigger kind: ${req.trigger.kind}`);
    }

    const values = req.trigger.values as unknown as AlignedValues;
    const costPerPerson = estimateTripCostPerPerson(values.places, values.airline, values.dates);
    const feasible = costPerPerson <= values.budget.max;

    const prompt = feasible
      ? `The group aligned on: dates ${JSON.stringify(values.dates)}, budget ${JSON.stringify(values.budget)}, places ${values.places.join(', ')}, airline ${values.airline}. Estimated cost per person: $${costPerPerson}. Write a short, upbeat finalized itinerary message summarizing all of this for the group.`
      : `The group aligned on: dates ${JSON.stringify(values.dates)}, budget ${JSON.stringify(values.budget)}, places ${values.places.join(', ')}, airline ${values.airline}. Estimated cost per person is $${costPerPerson}, which exceeds their budget of $${values.budget.max}. Write a short message explaining the shortfall and suggesting they adjust the airline or drop a destination.`;

    return { text: await callClaudeText(client, prompt, 512), feasible };
  }

  return { invokeReactiveAgent, invokeProactiveAgent };
}
