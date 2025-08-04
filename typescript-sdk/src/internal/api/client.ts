import openApiCreateClient from "openapi-fetch";
import type { paths } from "../generated/openapi/api-client";
import { z } from "zod";
import { getApiKey, getEndpoint } from "../../client";

// Define the client type explicitly to avoid naming issues
export type LangwatchApiClient = ReturnType<typeof openApiCreateClient<paths>>;

const configSchema = z.object({
  apiKey: z.string().min(1, "API key is required"),
  endpoint: z.string().url("Endpoint must be a valid URL"),
});

export function createLangWatchApiClient(apiKey?: string | undefined, endpoint?: string | undefined ): LangwatchApiClient {
  // This will error if the config is invalid
  const config = configSchema.parse({
    apiKey: apiKey ?? getApiKey(),
    endpoint: endpoint ?? getEndpoint(),
  });

  return openApiCreateClient<paths>({
    baseUrl: config.endpoint,
    headers: {
      "X-Auth-Token": config.apiKey,
      "Content-Type": "application/json",
    },
  });
}


