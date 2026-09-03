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
import {
  scopedApiKey,
  scopedProjectId,
  scopedSurface,
} from "@/internal/credentialContext";
import { CLI_SURFACE_HEADER, CLI_SURFACE_VALUE } from "@/internal/surface";
import { buildAuthHeaders } from "./auth";
import { handledErrorFrom } from "./errors";

/**
 * Turns a NAMED failure into a typed throw, once, for every call that goes
 * through this client.
 *
 * This lives in the transport rather than in each service because it is a
 * property of the WIRE, not of any one resource: the platform answers a declined
 * request with a `HandledError` — a `kind`, a status, a `meta` bag — and that is
 * true of `/api/traces` and `/api/prompts` alike. Reading it here means no
 * service has to remember to, and a service added tomorrow gets it for free.
 *
 * WHAT IT DOES NOT DO is just as load-bearing: a response whose body is not a
 * domain error — a 5xx, a proxy's HTML error page, a truncated body, anything at
 * all it cannot read — is left completely alone. `onResponse` returns nothing,
 * openapi-fetch carries on and hands the service the `{ error }` it always did,
 * and the service throws the same generic error it always threw. This is a
 * strict superset of the old behaviour: it only ever ADDS a type where there was
 * a string.
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
 * @param apiKey - The API key or Personal Access Token used for authentication.
 *                 Defaults to `LANGWATCH_API_KEY`.
 * @param endpoint - The endpoint to use for the API client. Defaults to `LANGWATCH_ENDPOINT`
 *                   or the internal `DEFAULT_ENDPOINT`.
 * @param projectId - Project identifier. Required when `apiKey` is a PAT
 *                    (`pat-lw-*`). Defaults to `LANGWATCH_PROJECT_ID`.
 * @returns A new LangWatch API client.
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
  projectId: string | undefined = scopedProjectId() ??
    process.env.LANGWATCH_PROJECT_ID,
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
      // The request-scoped surface (set at the CLI's request boundaries,
      // internal/credentialContext.ts) lets the platform's traffic
      // attribution tell CLI traffic apart from a plain SDK embed, which
      // scopes nothing and sends none of this.
      ...(scopedSurface() === "cli"
        ? { [CLI_SURFACE_HEADER]: CLI_SURFACE_VALUE }
        : {}),
    },
  });

  client.use(handledErrorMiddleware);

  return client;
};


export type LangwatchApiClient = ReturnType<typeof createLangWatchApiClient>;
