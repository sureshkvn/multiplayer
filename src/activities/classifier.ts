import type { AnthropicLike } from './anthropic-like.js';
import { callClaudeText, extractJsonObject } from './anthropic-like.js';
import type { IncomingMessage } from '../core/events/types.js';
import type { ClassifierOutput } from '../core/classification/types.js';

export interface TranscriptEntry {
  speaker: string;
  text: string;
}

export function createClassifier(client: AnthropicLike) {
  async function classify(msg: IncomingMessage, history: TranscriptEntry[] = []): Promise<ClassifierOutput> {
    const transcript = history.map((h) => `${h.speaker}: ${h.text}`).join('\n');

    const prompt = `You are a message classifier for a group chat. Given the recent conversation and the newest message, output ONLY JSON with this exact shape:
{
  "addressee": { "kind": "agent" | "human" | "group" | "none", "participantId"?: string, "confidence": number },
  "actionability": { "kind": "command" | "question" | "deliberation" | "social", "intent"?: string, "confidence": number },
  "observations": [ { "participantId": string, "text": string } ]
}
Rules:
- "addressee.kind" is "agent" only if the message clearly directs itself at an AI assistant (e.g. "hey agent", "@assistant").
- "actionability.kind" is "deliberation" when humans are negotiating/discussing among themselves, "social" for chatter/thanks with no substantive content.
- "observations" lists any preferences, constraints, or proposals the CURRENT speaker stated. Write each one as a FULLY QUALIFIED statement — if the current message omits details (e.g. a month or year) that were already established earlier in the conversation, fill them in from that context rather than copying the fragment verbatim. Example: if an earlier message proposed "Dec 20th to Dec 28th" and the current message says "ok, 20th to 27th it is", the observation text must be "December 20th to December 27th", not the bare "20th to 27th" — the reader of this text will have no access to the conversation, only to what you write here.
- If the CURRENT message is a short agreement/affirmation ("great", "works for me", "yes", "ok", "sounds good", "me too", etc.) that is agreeing to a specific proposal made earlier in the conversation, include an observation attributing that SAME proposal's full content to the current speaker (e.g. if someone earlier proposed "Dec 20-27" and the current speaker says "works for me", emit an observation with text "Dec 20-27" for the current speaker). Look back through the whole transcript to find what is being agreed to — the agreement may be several messages back.
- If the current message doesn't restate or agree to anything substantive, "observations" is an empty array.

Recent conversation:
${transcript || '(no prior messages)'}

Current speaker: ${msg.speakerId}
Current message: "${msg.text}"`;

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
