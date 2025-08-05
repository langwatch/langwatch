import openApiCreateClient from "openapi-fetch";
import type { paths } from "../generated/openapi/api-client";
import { z } from "zod";
import { version } from "../../../package.json";

// Define the client type explicitly to avoid naming issues
export type LangwatchApiClient = ReturnType<typeof openApiCreateClient<paths>>;

const configSchema = z.object({
  apiKey: z.string().min(1, "API key is required"),
  endpoint: z.url("Endpoint must be a valid URL"),
});

export function createLangWatchApiClient(apiKey: string, endpoint: string): LangwatchApiClient {
  // This will error if the config is invalid
  const config = configSchema.parse({
    apiKey: apiKey,
    endpoint: endpoint,
  });

  return openApiCreateClient<paths>({
    baseUrl: config.endpoint,
    headers: {
      "Authorization": `Bearer ${config.apiKey}`,
      "X-Auth-Token": config.apiKey,
      "Content-Type": "application/json",
      "User-Agent": `langwatch-sdk-node/${version}`,
    },
  });
}


