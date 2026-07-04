import type { AnthropicLike } from './anthropic-like.js';
import { callClaudeText } from './anthropic-like.js';
import type { IncomingMessage } from '../core/events/types.js';
import type { MessageSignals } from '../core/classification/types.js';
import type { FacilitationTrigger } from '../core/facilitation/types.js';
import type { Reconciliation } from '../core/comparators/types.js';
import { estimateTripCostPerPerson } from '../domain/japan-trip.js';
import type { Range } from '../core/comparators/range.js';

export interface ReactiveRequest {
  msg: IncomingMessage;
  signals: MessageSignals;
  expectedVersion: number;
  dimensionStatus: Record<string, Reconciliation>;
}

const DIMENSION_LABELS: Record<string, string> = {
  dates: 'dates',
  budget: 'budget',
  places: 'places',
  airline: 'airline',
};

function formatDate(epochMs: number): string {
  return new Date(epochMs).toISOString().slice(0, 10);
}

function formatDimensionValue(dimId: string, value: unknown): string {
  if (dimId === 'dates') {
    const { min, max } = value as Range;
    return `${formatDate(min)} to ${formatDate(max)}`;
  }
  if (dimId === 'budget') {
    const { min, max } = value as Range;
    return `$${min}-$${max} per person`;
  }
  if (Array.isArray(value)) return value.join(', ');
  return String(value);
}

// The reactive path historically read only the current message + signals,
// never the objective-model projection (per the original contract's
// invariant). That meant a direct question like "are we aligned on dates?"
// was literally unanswerable — the model had no state to draw on. This
// summary is a deliberate, documented deviation: it gives the reactive
// prompt read-only visibility into current alignment status so it can
// answer state-aware questions, without changing whether/when it gets
// invoked (that decision is still made from signals alone, upstream).
function summarizeDimensionStatus(dimensionStatus: Record<string, Reconciliation>): string {
  return Object.entries(dimensionStatus)
    .map(([dimId, status]) => {
      const label = DIMENSION_LABELS[dimId] ?? dimId;
      if (status.status === 'aligned') return `${label}: aligned on ${formatDimensionValue(dimId, status.value)}`;
      if (status.status === 'conflict') return `${label}: conflicting (${status.detail})`;
      return `${label}: not yet decided`;
    })
    .join('; ');
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
    const statusSummary = summarizeDimensionStatus(req.dimensionStatus);
    const prompt = `You are a helpful trip-planning assistant in a group chat about a trip to Japan.

Current group alignment status: ${statusSummary}

A participant said: "${req.msg.text}". Respond helpfully and briefly (2-3 sentences). If they're asking whether the group has decided or aligned on something, answer directly from the status above rather than saying you don't have visibility into it.`;
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
