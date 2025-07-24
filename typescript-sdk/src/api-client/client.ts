import openApiCreateClient from "openapi-fetch";
import type { paths } from "./langwatch-openapi.ts";
import { z } from "zod";

interface LangWatchApiClientOptions {
  apiKey?: string;
  endpoint?: string;
}

const configSchema = z.object({
  apiKey: z.string().min(1, "API key is required"),
  endpoint: z.string().url().optional().default("https://app.langwatch.ai"),
});

export function createClient(options?: LangWatchApiClientOptions) {
  // This will error if the config is invalid
  const config = configSchema.parse({
    apiKey: options?.apiKey ?? process.env.LANGWATCH_API_KEY,
    endpoint: options?.endpoint ?? process.env.LANGWATCH_ENDPOINT,
  });

  return openApiCreateClient<paths>({
    baseUrl: config.endpoint,
    headers: {
      "X-Auth-Token": config.apiKey,
      "Content-Type": "application/json",
    },
  });
}

export type LangwatchApiClient = ReturnType<typeof createClient>;
