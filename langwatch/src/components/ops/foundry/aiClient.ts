export interface AIGenerateResult {
  messages: Array<{ role: string; content: string }>;
  promptTokens?: number;
  completionTokens?: number;
}

export async function generateWithAI({
  provider,
  apiKey,
  model,
  topic,
}: {
  provider: "openai" | "xai";
  apiKey: string;
  model: string;
  topic?: string;
}): Promise<AIGenerateResult> {
  const baseUrl =
    provider === "xai"
      ? "https://api.x.ai/v1"
      : "https://api.openai.com/v1";

  const systemPrompt =
    "Generate a realistic, concise conversation between a user and an AI assistant. Return exactly one user message and one assistant response. Keep it under 100 words total.";

  const userPrompt = topic
    ? `Topic: ${topic}`
    : "Pick an interesting topic about technology or science.";

  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      temperature: 0.8,
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`AI API error ${response.status}: ${text}`);
  }

  const data = await response.json();
  const content = data.choices?.[0]?.message?.content ?? "";

  // Parse the generated conversation
  const lines = content.split("\n").filter((l: string) => l.trim());
  const userMsg =
    lines.find((l: string) => l.toLowerCase().startsWith("user:"))?.replace(/^user:\s*/i, "") ??
    "What can you help me with?";
  const assistantMsg =
    lines.find((l: string) => l.toLowerCase().startsWith("assistant:"))?.replace(/^assistant:\s*/i, "") ??
    content;

  return {
    messages: [
      { role: "user", content: userMsg },
      { role: "assistant", content: assistantMsg },
    ],
    promptTokens: data.usage?.prompt_tokens,
    completionTokens: data.usage?.completion_tokens,
  };
}
