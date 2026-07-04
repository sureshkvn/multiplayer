import type { AnthropicLike } from './anthropic-like.js';
import { callClaudeText, extractJsonArray } from './anthropic-like.js';
import type { RawObservation, ObservationPayload, Strength } from '../core/classification/types.js';
import type { DimensionSpec } from '../core/comparators/types.js';

export function createNormalizer(client: AnthropicLike, dimensions: DimensionSpec[]) {
  async function normalize(raw: RawObservation[]): Promise<ObservationPayload[]> {
    if (raw.length === 0) return [];

    const dimList = dimensions.map((d) => `- ${d.id}: ${d.label}`).join('\n');
    const prompt = `Map each stated observation onto one of these decision dimensions:
${dimList}

For each observation below, output ONLY a JSON array of objects shaped:
{ "participantId": string, "dimensionId": string, "value": <dimension-appropriate value>, "strength": "lean" | "prefer" | "insist" }

Value formats:
- "dates": { "min": <epoch ms UTC midnight of start date>, "max": <epoch ms UTC midnight of end date> }
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
      value: item.value,
      strength: item.strength,
    }));
  }

  return { normalize };
}
