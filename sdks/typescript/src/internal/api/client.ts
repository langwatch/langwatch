import openApiCreateClient, { type Middleware } from "openapi-fetch";
import type { paths } from "../generated/openapi/api-client";
import { version } from "../../../package.json";
import {
  LANGWATCH_SDK_LANGUAGE,
  LANGWATCH_SDK_NAME_OBSERVABILITY,
  LANGWATCH_SDK_RUNTIME,
  LANGWATCH_SDK_VERSION,
} from "../constants";
import { resolveEndpoint } from "@/internal/endpoint";
import { scopedApiKey, scopedProjectId } from "@/internal/credentialContext";
import { buildAuthHeaders } from "./auth";
import { handledErrorFrom } from "./errors";

/**
 * Turns a NAMED failure into a typed throw, once, for every call that goes through this
 * client.
 */
const handledErrorMiddleware: Middleware = {
  async onResponse({ request, response }) {
    if (response.ok) return;

    // openapi-fetch reads the body itself further down the pipeline, and a body
    // can only be read once. Clone, or the non-domain path gets an empty error.
    const contentType = response.headers.get("content-type") ?? "";
    if (!contentType.includes("json")) return;

    let body: unknown;
    try {
      body = await response.clone().json();
    } catch {
      // A body that claims JSON and isn't is exactly the case this must not
      // crash on. Leave it to the generic path.
      return;
    }

    const handledError = handledErrorFrom({
      body,
      status: response.status,
      // The platform's own sentence is the message; there is no operation to
      // prefix it with down here, and the CLI adds "Failed to <action>" itself.
      operation: `${request.method} ${new URL(request.url).pathname}`,
      message: undefined,
    });

    if (handledError) throw handledError;
  },
};

/**
 * Creates a new LangWatch API client.
 * @param apiKey - The API key or Personal Access Token. Defaults to `LANGWATCH_API_KEY`.
 * @param endpoint - The API endpoint. Defaults to `LANGWATCH_ENDPOINT` or `DEFAULT_ENDPOINT`.
 */
export const createLangWatchApiClient = (
  // The request-scoped key (the CLI resolver's output) wins over the global
  // env: in the daemon the resolved device-session key lives ONLY in the
  // async-scoped store, never in the shared process.env, so concurrent
  // requests can't read each other's credential. A plain SDK embed sets no
  // scope and falls back to the environment unchanged.
  apiKey: string = scopedApiKey() ?? process.env.LANGWATCH_API_KEY ?? "",
  endpoint?: string,
  // Same precedence as the key: the request-scoped target project (the CLI
  // resolver's output, personal by default and `--project` when given) wins
  // over the global env, and a plain SDK embed that scopes nothing falls back
  // to the environment unchanged.
  projectId: string | undefined = scopedProjectId() ?? process.env.LANGWATCH_PROJECT_ID,
) => {
  const client = openApiCreateClient<paths>({
    baseUrl: resolveEndpoint(endpoint),
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

  client.use(handledErrorMiddleware);

  return client;
};

export type LangwatchApiClient = ReturnType<typeof createLangWatchApiClient>;
