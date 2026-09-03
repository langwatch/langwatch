/**
 * The MCP consent exchange, as this application performs it.
 *
 * `/mcp/authorize` POSTs to `POST /api/mcp/authorize`, a route this application
 * serves, and THE OTHER SIDE OF THAT EXCHANGE IS AN MCP CLIENT: an editor or a
 * desktop app is sitting on its own registered callback waiting for the redirect
 * this answer carries. So the wire is a compatibility surface with software we
 * do not ship, not an internal detail, and it is reproduced here byte for byte
 * from what `platform/app/src/pages/mcp/authorize.tsx` sent — the same path, the
 * same method and header, the same snake-cased body keys, and the same reading
 * of the response: a `redirect` outranks a non-OK status, because a failure the
 * server could attribute to this client comes back AS a redirect carrying the
 * OAuth error so the waiting application is told what went wrong.
 *
 * IT LIVES IN THE GLOBAL LAYER RATHER THAN IN THE FEATURE, and that is a rule
 * rather than a preference: `ui-browser-capability` forbids
 * `apps/ui/src/features/*` from naming `fetch`, and `src/behavior/` is the
 * browser-transport home the feature-pilot gate carved out for exactly this —
 * the same place the `/cli/auth` device flow went. The authorize frontend
 * feature adapts this one function onto `@langwatch/api-key-web`'s host port.
 *
 * WHAT IS NOT HERE is the redirect-scheme allowlist. That check is the screen's,
 * in `@langwatch/api-key-web`'s `model/redirect-schemes`, because it is the
 * second lock behind the server's own client-registry check and a lock a
 * different host could answer differently is not a lock.
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
    error_description:
      typeof body.error_description === "string" ? body.error_description : void 0,
  };
}
