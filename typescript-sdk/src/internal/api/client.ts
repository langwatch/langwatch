import openApiCreateClient from "openapi-fetch";
import type { paths } from "../generated/openapi/api-client";
import { version } from "../../../package.json";
import { LANGWATCH_SDK_LANGUAGE, LANGWATCH_SDK_NAME_OBSERVABILITY, LANGWATCH_SDK_RUNTIME, LANGWATCH_SDK_VERSION } from "../constants";

export type LangwatchApiClient = ReturnType<typeof openApiCreateClient<paths>>;

export function createLangWatchApiClient(
  apiKey?: string  ,
  endpoint?: string  ,
): LangwatchApiClient {
  return openApiCreateClient<paths>({
    baseUrl: endpoint,
    headers: {
      "authorization": `Bearer ${apiKey}`,
      "x-auth-token": apiKey,
      "content-type": "application/json",
      "user-agent": `langwatch-sdk-node/${version}`,
      "x-langwatch-sdk-name": LANGWATCH_SDK_NAME_OBSERVABILITY,
      "x-langwatch-sdk-language": LANGWATCH_SDK_LANGUAGE,
      "x-langwatch-sdk-version": LANGWATCH_SDK_VERSION,
      "x-langwatch-sdk-platform": LANGWATCH_SDK_RUNTIME(),
    },
  });
}
