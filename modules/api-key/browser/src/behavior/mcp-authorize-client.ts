/**
 * `POST /api/mcp/authorize` — the hosted-mcp module's own door. The request
 * shape already matches the posted fields one for one, so this is the wire
 * verbatim rather than a translation.
 */

import type { McpAuthorizeAnswer, McpAuthorizeRequest } from "../model/authorize-host.ts";

type ApprovedBody = { redirect: string };
type RefusedBody = { error: string; error_description?: string };

export async function authorizeMcpClient(
  request: McpAuthorizeRequest,
): Promise<McpAuthorizeAnswer> {
  let response: Response;
  try {
    response = await fetch("/api/mcp/authorize", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify(request),
    });
  } catch (error) {
    return {
      ok: false,
      error: "network_error",
      error_description: error instanceof Error ? error.message : "network error",
    };
  }
  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as Partial<RefusedBody>;
    return {
      ok: false,
      error: body.error ?? "request_failed",
      error_description: body.error_description,
    };
  }
  const body = (await response.json()) as ApprovedBody;
  return { ok: true, redirect: body.redirect };
}
