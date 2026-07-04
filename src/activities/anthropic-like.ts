export interface AnthropicLike {
  messages: {
    create(params: { model: string; max_tokens: number; messages: { role: 'user'; content: string }[] }): Promise<{
      content: { type: string; text?: string }[];
    }>;
  };
}

export function extractJsonObject(text: string): string {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end === -1) throw new Error(`No JSON object found in model response: ${text}`);
  return text.slice(start, end + 1);
}

export function extractJsonArray(text: string): string {
  const start = text.indexOf('[');
  const end = text.lastIndexOf(']');
  if (start === -1 || end === -1) throw new Error(`No JSON array found in model response: ${text}`);
  return text.slice(start, end + 1);
}

export async function callClaudeText(client: AnthropicLike, prompt: string, maxTokens = 1024): Promise<string> {
  const response = await client.messages.create({
    model: 'claude-sonnet-5',
    max_tokens: maxTokens,
    messages: [{ role: 'user', content: prompt }],
  });
  const block = response.content.find((b) => b.type === 'text');
  if (!block?.text) throw new Error('Model returned no text content');
  return block.text;
}
