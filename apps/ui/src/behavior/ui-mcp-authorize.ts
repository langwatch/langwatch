/**
 * The MCP consent exchange, reproduced byte for byte — THE OTHER SIDE IS
 * AN MCP CLIENT waiting on its own callback, so a `redirect` outranks a
 * non-OK status. The scheme allowlist is NOT here — it's the screen's own lock.
 */

/** The OAuth parameters the consent screen reviewed, as the route takes them. */
export type UiMcpAuthorizeRequest = {
  projectId: string;
  redirect_uri: string;
  state: string;
  code_challenge: string;
  code_challenge_method: string;
  client_id: string;
};

/** What `POST /api/mcp/authorize` answered, in RFC 6749 §4.1.2.1 terms. */
export type UiMcpAuthorizeAnswer = {
  ok: boolean;
  redirect?: string;
  error?: string;
  error_description?: string;
};

export async function authorizeUiMcpClient(
  request: UiMcpAuthorizeRequest,
): Promise<UiMcpAuthorizeAnswer> {
  const response = await fetch("/api/mcp/authorize", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(request),
  });

  // A body that is not JSON is a failure with nothing to say, which the screen
  // reports as an unknown error exactly as the platform page's `catch` did.
  const body = (await response.json()) as {
    redirect?: unknown;
    error?: unknown;
    error_description?: unknown;
  };

  return {
    ok: response.ok,
    redirect: typeof body.redirect === "string" ? body.redirect : void 0,
    error: typeof body.error === "string" ? body.error : void 0,
    error_description: typeof body.error_description === "string" ? body.error_description : void 0,
  };
}
