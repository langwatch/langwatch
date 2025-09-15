import openApiCreateClient from "openapi-fetch";
import type { paths } from "../generated/openapi/api-client";
import { version } from "../../../package.json";
import {
  LANGWATCH_SDK_LANGUAGE,
  LANGWATCH_SDK_NAME_OBSERVABILITY,
  LANGWATCH_SDK_RUNTIME,
  LANGWATCH_SDK_VERSION,
} from "../constants";
import { DEFAULT_ENDPOINT } from "@/internal/constants";


/**
 * Creates a new LangWatch API client.
 * @param apiKey - The API key to use for authentication.
 * @param endpoint - The endpoint to use for the API client.
 * @returns A new LangWatch API client.
 */
export const createLangWatchApiClient = (
  apiKey?: string,
  endpoint?: string
) => {
  return openApiCreateClient<paths>({
    baseUrl: endpoint ?? process.env.LANGWATCH_ENDPOINT ?? DEFAULT_ENDPOINT,
    headers: {
      ...(apiKey ? { authorization: `Bearer ${apiKey}`, 'x-auth-token': apiKey } : {}),
      "content-type": "application/json",
      "user-agent": `langwatch-sdk-node/${version}`,
      "x-langwatch-sdk-name": LANGWATCH_SDK_NAME_OBSERVABILITY,
      "x-langwatch-sdk-language": LANGWATCH_SDK_LANGUAGE,
      "x-langwatch-sdk-version": LANGWATCH_SDK_VERSION,
      "x-langwatch-sdk-platform": LANGWATCH_SDK_RUNTIME(),
    },
  });
};


export type LangwatchApiClient = ReturnType<typeof createLangWatchApiClient>;
