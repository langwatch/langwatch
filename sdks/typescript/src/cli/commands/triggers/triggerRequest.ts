import { resolveControlPlaneUrl } from "@/cli/utils/governance/resolveEndpoint";
import { buildRequestHeaders } from "@/internal/api/request-headers";
import { scopedApiKey } from "@/internal/credentialContext";
import { langwatchFetch } from "@/internal/http/langwatchFetch";

/** Per-request deadline: without one, a peer that keeps the socket open hangs
 *  the CLI forever (`require-fetch-timeout-ts`). */
const TRIGGER_REQUEST_TIMEOUT_MS = 30_000;

/** One `/api/v1/triggers` call with the caller's key and the deadline. `path` is
 *  what follows `/api/v1/triggers`; a POST or PATCH announces a JSON body. */
export function triggerRequest({
  path = "",
  method = "GET",
  body,
}: {
  path?: string;
  method?: "GET" | "POST" | "PATCH" | "DELETE";
  body?: unknown;
}): Promise<Response> {
  const apiKey = scopedApiKey() ?? process.env.LANGWATCH_API_KEY ?? "";
  const sendsJson = method === "POST" || method === "PATCH";
  return langwatchFetch(`${resolveControlPlaneUrl()}/api/v1/triggers${path}`, {
    signal: AbortSignal.timeout(TRIGGER_REQUEST_TIMEOUT_MS),
    ...(method === "GET" ? {} : { method }),
    headers: {
      ...(sendsJson ? { "Content-Type": "application/json" } : {}),
      ...buildRequestHeaders({ apiKey }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}
