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
import { buildAuthHeaders } from "./auth";


/**
 * Creates a new LangWatch API client.
 * @param apiKey - The API key or Personal Access Token used for authentication.
 *                 Defaults to `LANGWATCH_API_KEY`.
 * @param endpoint - The endpoint to use for the API client. Defaults to `LANGWATCH_ENDPOINT`
 *                   or the internal `DEFAULT_ENDPOINT`.
 * @param projectId - Project identifier. Required when `apiKey` is a PAT
 *                    (`pat-lw-*`). Defaults to `LANGWATCH_PROJECT_ID`.
 * @returns A new LangWatch API client.
 */
export const createLangWatchApiClient = (
  apiKey: string = process.env.LANGWATCH_API_KEY ?? "",
  endpoint: string = process.env.LANGWATCH_ENDPOINT ?? DEFAULT_ENDPOINT,
  projectId: string | undefined = process.env.LANGWATCH_PROJECT_ID,
) => {
  return openApiCreateClient<paths>({
    baseUrl: endpoint,
    headers: {
      ...buildAuthHeaders({ apiKey, projectId }),
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
