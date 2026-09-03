/**
 * `POST /api/mcp/authorize` — the approval step of the hosted MCP OAuth flow.
 *
 * The consent page posts here once a signed-in person has approved a client's
 * request. It verifies the client and its redirect URI, mints a short-lived
 * authorization code bound to the project's credential, and hands the page the
 * URL to send the client back to.
 *
 * The refusals answer `c.json` with a top-level `error` and
 * `error_description` rather than the handled-error envelope, deliberately:
 * OAuth clients parse those two fields at the top level of the body
 * (RFC 6749 §5.2), and a nested envelope reads to them as a malformed
 * response. This endpoint speaks the OAuth wire format, so the shape below is
 * the contract; do not "fix" it into the envelope.
 */
import { handlerManagedAuth } from "@langwatch/api";
import type { AppRestSecurity, MountableRestApp } from "@langwatch/api/rest";
import { randomUUID } from "node:crypto";

import type { HostedMcpRedis } from "../../ports/hosted-mcp.port";
import { getOAuthClient } from "../../repositories/redis/redis.oauth-client.repository";

const REDIS_AUTH_CODE_PREFIX = "mcp:auth_code:";
const AUTH_CODE_TTL_SECONDS = 600;

/**
 * Schemes an OAuth redirect_uri may never use.
 *
 * TRANSCRIBED from `@langwatch/api-key-web`'s `redirect-schemes.ts` rather than
 * imported: the consent page that navigates to the URI is a browser module, and
 * no server transport may value-import one. The two copies are pinned by the
 * literal list below and by that module's own — a divergence would let this
 * door mint a code for a URI the page then refuses to follow, or worse.
 *
 * A deny-list rather than an `http:`/`https:` allow-list on purpose. Native MCP
 * clients complete the flow through a custom-scheme callback they register with
 * the operating system, and RFC 8252 §7.1 names exactly that as the redirect
 * for a native app; an allow-list would refuse every one of them. So the list
 * names what a BROWSER executes or resolves against our own origin, which is
 * the class that turns a redirect into script execution.
 */
const DISALLOWED_REDIRECT_SCHEMES: readonly string[] = [
  "javascript:",
  "vbscript:",
  "data:",
  "blob:",
  "filesystem:",
];

/** Whether a redirect_uri is safe to navigate to. Unparseable means no. */
function isAllowedRedirectScheme(candidate: string): boolean {
  try {
    return !DISALLOWED_REDIRECT_SCHEMES.includes(new URL(candidate).protocol);
  } catch {
    return false;
  }
}

/** The signed-in person behind the request, as this process resolves one. */
export type McpAuthorizeSession = Readonly<{ user: Readonly<{ id: string }> }>;

/** The project an authorization code is minted against. */
export type McpAuthorizeProject = Readonly<{
  id: string;
  apiKey: string;
  archivedAt: Date | null;
}>;

/** What the authorize step reaches that it does not own. */
export interface McpAuthorizeRestPorts {
  /** The signed-in person behind this request, or null for an anonymous one. */
  resolveSession(request: Request): Promise<McpAuthorizeSession | null>;
  /** The project, with the credential the code embeds. Null when unreadable. */
  tryGetProject(projectId: string): Promise<McpAuthorizeProject | null>;
  /** Whether that person may view that project. */
  probeProjectPermission(input: {
    session: McpAuthorizeSession;
    projectId: string;
  }): Promise<boolean>;
  /**
   * Whether the project is the globally-readable demo showcase.
   *
   * Its own port rather than a permission probe, because the demo project
   * grants `project:view` to ANY caller — so a probe would PASS for it, and
   * any authenticated person could mint a code embedding the demo project's
   * API key. This is checked BEFORE the probe for exactly that reason.
   */
  isDemoProject(projectId: string): boolean;
  /** The at-rest cipher the embedded credential is written under. */
  encrypt(value: string): string;
  /** Where the code lives for its ten minutes. Null means no code can be minted. */
  redis: HostedMcpRedis | null;
}

/** `POST /api/mcp/authorize`, built against one process's security. */
export function createMcpAuthorizeRestApp(options: {
  security: AppRestSecurity;
  ports: McpAuthorizeRestPorts;
}): MountableRestApp {
  const { security, ports } = options;
  const secured = security.createServiceApp({ basePath: "/api" });

  secured
    .access(
      handlerManagedAuth({
        reason: "user session validated in-handler",
        // OAuth authorize step; no RBAC permission gates it.
        permissions: [],
        credential: "session",
      }),
    )
    .post("/mcp/authorize", async (c) => {
      const session = await ports.resolveSession(c.req.raw);
      if (!session) {
        return c.json({ error: "Not authenticated" }, 401);
      }

      let body: Record<string, unknown>;
      try {
        body = (await c.req.json()) as Record<string, unknown>;
      } catch {
        return c.json({ error: "Invalid body" }, 400);
      }

      const projectId = asString(body.projectId);
      const redirectUri = asString(body.redirect_uri);
      const clientId = asString(body.client_id);
      const state = asString(body.state);
      const codeChallenge = asString(body.code_challenge);
      const codeChallengeMethod = asString(body.code_challenge_method);

      if (!projectId || !redirectUri || !clientId) {
        return c.json({ error: "projectId, redirect_uri and client_id are required" }, 400);
      }

      try {
        new URL(redirectUri);
      } catch {
        return c.json({ error: "Invalid redirect_uri" }, 400);
      }
      if (!isAllowedRedirectScheme(redirectUri)) {
        return c.json({ error: "redirect_uri uses a disallowed scheme" }, 400);
      }

      // RFC 6749 §10.6: an authorization server must only ever issue a code to
      // a redirect_uri that was registered for this client_id — otherwise
      // whoever crafts the authorization request (which can be an attacker,
      // not the approving user) can point it at a URI they control and the
      // approved code is exfiltrated there. PKCE does not defend against this:
      // it proves the token-exchanger holds the verifier for the challenge in
      // the code, and an attacker who authored the request holds both. Exact
      // string match against the client's registered redirect_uris — no
      // scheme/host-only comparison, which a subdomain or path trick could
      // slip past.
      const registeredClient = await getOAuthClient({ redis: ports.redis, clientId });
      if (!registeredClient) {
        return c.json({ error: "Unknown or unregistered client_id" }, 400);
      }
      if (!registeredClient.redirectUris.includes(redirectUri)) {
        return c.json(
          { error: "redirect_uri does not match any redirect URI registered for this client_id" },
          400,
        );
      }

      // Past this point the client_id is registered and the redirect_uri is one
      // of the URIs it registered, so RFC 6749 §4.1.2.1 says a failure belongs
      // back at the client rather than on this page: the client is waiting on
      // its redirect and an error rendered here leaves it hanging forever. The
      // checks above deliberately stay local — an unverified redirect_uri is
      // exactly what an attacker would supply, so nothing is ever sent to it.
      const errorRedirect = ({ error, description }: { error: string; description: string }) => {
        const url = new URL(redirectUri);
        url.searchParams.set("error", error);
        url.searchParams.set("error_description", description);
        if (state) url.searchParams.set("state", state);
        return url.toString();
      };

      if (!codeChallenge) {
        const description = "code_challenge is required (PKCE S256)";
        return c.json(
          {
            error: "invalid_request",
            error_description: description,
            redirect: errorRedirect({ error: "invalid_request", description }),
          },
          400,
        );
      }

      // S256 is the only method the discovery document advertises, and the
      // token endpoint verifies every code as S256 regardless of what was
      // requested. Accepting another method here would mint a code that can
      // never be redeemed, so the client learns now rather than at the
      // exchange.
      if (codeChallengeMethod && codeChallengeMethod !== "S256") {
        const description = "code_challenge_method must be S256";
        return c.json(
          {
            error: "invalid_request",
            error_description: description,
            redirect: errorRedirect({ error: "invalid_request", description }),
          },
          400,
        );
      }

      const noAccessDescription = "Project not found or you don't have access";
      const noAccessResponse = () =>
        c.json(
          {
            error: "access_denied",
            error_description: noAccessDescription,
            redirect: errorRedirect({
              error: "access_denied",
              description: noAccessDescription,
            }),
          },
          403,
        );

      if (ports.isDemoProject(projectId)) {
        return noAccessResponse();
      }

      const project = await ports.tryGetProject(projectId);
      if (
        !project ||
        project.archivedAt !== null ||
        !(await ports.probeProjectPermission({ session, projectId }))
      ) {
        // A single 403 whether the project is missing, archived, or simply
        // inaccessible — never disclose the existence of a project the caller
        // cannot reach.
        return noAccessResponse();
      }

      const redis = ports.redis;
      if (!redis) {
        const description = "Authorization is temporarily unavailable";
        return c.json(
          {
            error: "server_error",
            error_description: description,
            redirect: errorRedirect({ error: "server_error", description }),
          },
          500,
        );
      }

      const code = randomUUID();
      await redis.set(
        `${REDIS_AUTH_CODE_PREFIX}${code}`,
        JSON.stringify({
          projectId: project.id,
          encryptedApiKey: ports.encrypt(project.apiKey),
          // Captured here so MCP tools that need a caller identity (governance
          // install/uninstall/rotate) can attribute audit rows to the actual
          // OAuth-flowing user instead of falling back to a project-wide
          // identity. Read at the token-exchange step.
          userId: session.user.id,
          codeChallenge,
          codeChallengeMethod: codeChallengeMethod ?? "S256",
          // Bound here so the token endpoint can require the exchange to
          // present the exact same client_id + redirect_uri this authorization
          // was validated and approved against (RFC 6749 §4.1.3 / §3.2.1) — a
          // code minted for one client's registered URI must never be
          // redeemable against another.
          clientId,
          redirectUri,
          expiresAt: Date.now() + AUTH_CODE_TTL_SECONDS * 1000,
        }),
        "EX",
        AUTH_CODE_TTL_SECONDS,
      );

      const redirectUrl = new URL(redirectUri);
      redirectUrl.searchParams.set("code", code);
      if (state) redirectUrl.searchParams.set("state", state);

      return c.json({ redirect: redirectUrl.toString() });
    });

  return secured.hono;
}

/** The value where the body carried a string, and nothing where it did not. */
function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}
