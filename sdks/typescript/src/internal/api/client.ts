import openApiCreateClient, { type Middleware } from "openapi-fetch";
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
import { domainErrorFrom } from "./errors";

/**
 * Turns a NAMED failure into a typed throw, once, for every call that goes
 * through this client.
 *
 * This lives in the transport rather than in each service because it is a
 * property of the WIRE, not of any one resource: the platform answers a declined
 * request with a `DomainError` — a `kind`, a status, a `meta` bag — and that is
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
const domainErrorMiddleware: Middleware = {
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

    const domainError = domainErrorFrom({
      body,
      status: response.status,
      // The platform's own sentence is the message; there is no operation to
      // prefix it with down here, and the CLI adds "Failed to <action>" itself.
      operation: `${request.method} ${new URL(request.url).pathname}`,
      message: undefined,
    });

    if (domainError) throw domainError;
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
  apiKey: string = process.env.LANGWATCH_API_KEY ?? "",
  endpoint: string = process.env.LANGWATCH_ENDPOINT ?? DEFAULT_ENDPOINT,
  projectId: string | undefined = process.env.LANGWATCH_PROJECT_ID,
) => {
  const client = openApiCreateClient<paths>({
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

  client.use(domainErrorMiddleware);

  return client;
};


export type LangwatchApiClient = ReturnType<typeof createLangWatchApiClient>;
