import { buildAuthHeaders } from "@/internal/api/auth";
import { formatFetchError } from "./formatFetchError";

declare const __CLI_VERSION__: string;

// `__CLI_VERSION__` is replaced at build time by the tsup `define` block in
// typescript-sdk/tsup.config.ts. Outside of a built CLI bundle (e.g. vitest)
// the identifier doesn't exist at runtime, so we fall back to a sentinel —
// the User-Agent stays well-formed and unit tests don't ReferenceError.
const CLI_VERSION =
  typeof __CLI_VERSION__ !== "undefined" ? __CLI_VERSION__ : "0.0.0-dev";

const USER_AGENT = `langwatch-cli/${CLI_VERSION}`;

export interface ApiRequestParams {
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  /** Path under the LangWatch endpoint, including any query string (e.g. "/api/monitors?foo=bar"). */
  path: string;
  /** JSON-serializable request body. Omit for GET/DELETE or empty POST bodies. */
  body?: unknown;
  apiKey: string;
  endpoint: string;
}

/**
 * Single chokepoint for every CLI request to the LangWatch control plane.
 *
 * Tags every outbound call with `User-Agent: langwatch-cli/<version>` so the
 * backend can attribute requests to source="cli" in the api_active_user
 * heartbeat metric (see PR #3589 / #3591). This is the CLI mirror of
 * `mcp-server/src/langwatch-api.ts::makeRequest`.
 *
 * Auth is delegated to `buildAuthHeaders` so PAT credentials still resolve
 * via Basic auth instead of being demoted to a plain Bearer.
 *
 * @throws Error with the formatted server message when the response is not OK.
 */
export async function apiRequest({
  method,
  path,
  body,
  apiKey,
  endpoint,
}: ApiRequestParams): Promise<unknown> {
  const headers: Record<string, string> = {
    "User-Agent": USER_AGENT,
    ...buildAuthHeaders({ apiKey }),
  };

  if (body !== undefined) {
    headers["Content-Type"] = "application/json";
  }

  const response = await fetch(`${endpoint}${path}`, {
    method,
    headers,
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });

  if (!response.ok) {
    const message = await formatFetchError(response);
    const error = new Error(message) as Error & { status?: number };
    error.status = response.status;
    throw error;
  }

  if (
    response.status === 204 ||
    response.headers?.get("content-length") === "0"
  ) {
    return null;
  }

  return response.json();
}
