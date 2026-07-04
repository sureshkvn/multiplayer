import type { AnthropicLike } from './anthropic-like.js';
import { callClaudeText, extractJsonArray } from './anthropic-like.js';
import type { RawObservation, ObservationPayload, Strength } from '../core/classification/types.js';
import type { DimensionSpec } from '../core/comparators/types.js';

// LLMs are unreliable at exact arithmetic. Asking the model to emit epoch-ms
// integers directly (the original approach) produced wildly wrong dates even
// for unambiguous input ("Dec 20th" was recorded as June). Instead, the model
// emits plain ISO calendar date strings, and this deterministic function does
// the epoch conversion — the model never touches millisecond math.
function isoDateToEpochMs(iso: string): number {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!match) throw new Error(`Expected an ISO date (YYYY-MM-DD), got: ${iso}`);
  const [, year, month, day] = match;
  return Date.UTC(Number(year), Number(month) - 1, Number(day));
}

export function createNormalizer(client: AnthropicLike, dimensions: DimensionSpec[]) {
  async function normalize(raw: RawObservation[]): Promise<ObservationPayload[]> {
    if (raw.length === 0) return [];

    const today = new Date().toISOString().slice(0, 10);
    const dimList = dimensions.map((d) => `- ${d.id}: ${d.label}`).join('\n');
    const prompt = `Map each stated observation onto one of these decision dimensions:
${dimList}

For each observation below, output ONLY a JSON array of objects shaped:
{ "participantId": string, "dimensionId": string, "value": <dimension-appropriate value>, "strength": "lean" | "prefer" | "insist" }

Today's date is ${today}. When an observation states a date without an explicit year, assume the nearest future occurrence of that month/day.

Value formats:
- "dates": { "min": "YYYY-MM-DD", "max": "YYYY-MM-DD" } (plain ISO calendar dates — do not compute epoch/millisecond values, just write the calendar date)
- "budget": { "min": <number>, "max": <number> } (per-person USD)
- "places": array of exactly 3 place name strings
- "airline": a single airline name string

If an observation doesn't map to any dimension, omit it.

Observations:
${JSON.stringify(raw)}`;

    const text = await callClaudeText(client, prompt);
    const items = JSON.parse(extractJsonArray(text)) as {
      participantId: string;
      dimensionId: string;
      value: unknown;
      strength: Strength;
    }[];

    return items.map((item) => ({
      scope: 'participant-objective' as const,
      participantId: item.participantId,
      dimensionId: item.dimensionId,
      value: item.dimensionId === 'dates' ? convertDatesValue(item.value) : item.value,
      strength: item.strength,
    }));
  }

  return { normalize };
}

function convertDatesValue(value: unknown): { min: number; max: number } {
  const { min, max } = value as { min: string; max: string };
  return { min: isoDateToEpochMs(min), max: isoDateToEpochMs(max) };
}
