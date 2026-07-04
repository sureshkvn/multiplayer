import type { AnthropicLike } from './anthropic-like.js';
import { callClaudeText, extractJsonObject } from './anthropic-like.js';
import type { IncomingMessage } from '../core/events/types.js';
import type { ClassifierOutput } from '../core/classification/types.js';

export function createClassifier(client: AnthropicLike) {
  async function classify(msg: IncomingMessage): Promise<ClassifierOutput> {
    const prompt = `You are a message classifier for a group chat. Given a message, output ONLY JSON with this exact shape:
{
  "addressee": { "kind": "agent" | "human" | "group" | "none", "participantId"?: string, "confidence": number },
  "actionability": { "kind": "command" | "question" | "deliberation" | "social", "intent"?: string, "confidence": number },
  "observations": [ { "participantId": string, "text": string } ]
}
Rules:
- "addressee.kind" is "agent" only if the message clearly directs itself at an AI assistant (e.g. "hey agent", "@assistant").
- "actionability.kind" is "deliberation" when humans are negotiating/discussing among themselves, "social" for chatter/thanks with no substantive content.
- "observations" lists any preferences, constraints, or proposals the speaker stated, verbatim.

Speaker: ${msg.speakerId}
Message: "${msg.text}"`;

    const text = await callClaudeText(client, prompt);
    const parsed = JSON.parse(extractJsonObject(text));

    return {
      addressee: { value: parsed.addressee, confidence: parsed.addressee.confidence },
      actionability: { value: parsed.actionability, confidence: parsed.actionability.confidence },
      observations: {
        value: parsed.observations.map((o: { participantId: string; text: string }) => ({ participantId: o.participantId, text: o.text })),
        confidence: 1,
      },
    };
  }

  return { classify };
}
