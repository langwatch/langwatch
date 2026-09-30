import { z } from "zod";

import type { Ledger } from "./ledger";

export const SONNET_MODEL = "claude-sonnet-5-5";

const responseSchema = z.object({
  content: z.array(z.object({ type: z.string(), text: z.string().optional() })),
  stop_reason: z.string().nullable(),
  usage: z.object({
    input_tokens: z.number(),
    output_tokens: z.number(),
    cache_read_input_tokens: z.number().nullish(),
    cache_creation_input_tokens: z.number().nullish(),
  }),
});

export interface SonnetConfig {
  apiKey: string;
  baseUrl?: string;
  fetchImpl?: typeof fetch;
}

/**
 * askSonnet sends one turn at medium effort and answers its text. The system
 * prompt is cached (it is the same for every feature); a declined request
 * falls back server-side, and a refusal that survives that is thrown.
 */
export const askSonnet = async ({
  config,
  ledger,
  system,
  prompt,
}: {
  config: SonnetConfig;
  ledger: Ledger;
  system: string;
  prompt: string;
}): Promise<string> => {
  const response = await (config.fetchImpl ?? fetch)(
    `${config.baseUrl ?? "https://api.anthropic.com"}/v1/messages`,
    {
      method: "POST",
      headers: {
        "x-api-key": config.apiKey,
        "anthropic-version": "2023-06-01",
        "anthropic-beta": "server-side-fallback-2026-07-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: SONNET_MODEL,
        max_tokens: 16_000,
        output_config: { effort: "medium" },
        fallbacks: "default",
        system: [{ type: "text", text: system, cache_control: { type: "ephemeral" } }],
        messages: [{ role: "user", content: prompt }],
      }),
      signal: AbortSignal.timeout(300_000),
    },
  );
  if (!response.ok) {
    throw new Error(`Sonnet answered ${response.status}: ${(await response.text()).slice(0, 300)}`);
  }
  const parsed = responseSchema.parse(await response.json());
  ledger.sonnetTurn({
    inputTokens: parsed.usage.input_tokens,
    outputTokens: parsed.usage.output_tokens,
    cacheReadTokens: parsed.usage.cache_read_input_tokens ?? 0,
    cacheWriteTokens: parsed.usage.cache_creation_input_tokens ?? 0,
  });
  if (parsed.stop_reason === "refusal") throw new Error("Sonnet declined the request");
  return parsed.content
    .flatMap((block) => (block.type === "text" ? [block.text ?? ""] : []))
    .join("");
};
