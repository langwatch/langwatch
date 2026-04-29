import { createLogger } from "../../utils/logger/server";
import { env } from "../../env.mjs";

const logger = createLogger("langwatch:auth0:password");

/**
 * Auth0's default database connection name. Customers who rename this in
 * their Auth0 tenant will need to adapt — we only support the default
 * (matches the documented setup for LangWatch Cloud).
 */
const AUTH0_DB_CONNECTION = "Username-Password-Authentication";

export type Auth0ErrorCode =
  | "insufficient_scope"
  | "not_configured"
  | "password_grant_not_enabled"
  | "unknown";

export class Auth0ApiError extends Error {
  readonly status: number;
  readonly code: Auth0ErrorCode;
  readonly body: unknown;

  constructor(args: {
    status: number;
    code: Auth0ErrorCode;
    message: string;
    body?: unknown;
  }) {
    super(args.message);
    this.name = "Auth0ApiError";
    this.status = args.status;
    this.code = args.code;
    this.body = args.body;
  }
}

interface Auth0Config {
  issuer: string;
  /** Client ID used for the Management API client_credentials grant. */
  mgmtClientId: string;
  /** Client Secret used for the Management API client_credentials grant. */
  mgmtClientSecret: string;
  audience: string;
}

function loadConfig(): Auth0Config {
  const issuer = env.AUTH0_ISSUER;
  // Prefer the dedicated Machine-to-Machine credentials when set. The
  // user-login Auth0 application is typically a Single Page Application,
  // which cannot use the client_credentials grant, so a separate M2M app
  // is required for Management API access. Fall back to the login app's
  // credentials only if M2M is not configured (works for tenants where
  // the login app is a Regular Web Application with Client Credentials
  // grant enabled — uncommon).
  const mgmtClientId = env.AUTH0_MGMT_CLIENT_ID ?? env.AUTH0_CLIENT_ID;
  const mgmtClientSecret =
    env.AUTH0_MGMT_CLIENT_SECRET ?? env.AUTH0_CLIENT_SECRET;
  if (!issuer || !mgmtClientId || !mgmtClientSecret) {
    throw new Auth0ApiError({
      status: 500,
      code: "not_configured",
      message:
        "Auth0 environment variables are not set. Set AUTH0_ISSUER and either AUTH0_MGMT_CLIENT_ID/SECRET (preferred — a separate Machine-to-Machine app) or AUTH0_CLIENT_ID/SECRET.",
    });
  }
  const trimmedIssuer = issuer.replace(/\/+$/, "");
  return {
    issuer: trimmedIssuer,
    mgmtClientId,
    mgmtClientSecret,
    audience: `${trimmedIssuer}/api/v2/`,
  };
}

async function parseJsonSafe(res: Response): Promise<unknown> {
  try {
    return await res.json();
  } catch {
    return undefined;
  }
}

/**
 * Hard cap on Auth0 HTTP calls. The default is "wait forever," which lets
 * an upstream stall hold a tRPC mutation hostage. 10s is well above
 * normal Auth0 latency (typically <300ms) but short enough that the
 * rate-limited user gets a useful error rather than a hung request.
 */
const AUTH0_HTTP_TIMEOUT_MS = 10_000;

/**
 * Wrap `fetch` so that:
 *   1. Every Auth0 call has an `AbortSignal.timeout()`.
 *   2. Transport-layer errors (network, DNS, abort) are normalized to
 *      `Auth0ApiError` — callers depend on `instanceof Auth0ApiError` to
 *      surface the right operator message.
 */
async function fetchAuth0(
  url: string,
  init: Omit<RequestInit, "signal">,
): Promise<Response> {
  try {
    return await fetch(url, {
      ...init,
      signal: AbortSignal.timeout(AUTH0_HTTP_TIMEOUT_MS),
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : String(error);
    throw new Auth0ApiError({
      status: 502,
      code: "unknown",
      message: `Auth0 request to ${url} failed before receiving a response: ${message}`,
      body: { transportError: message },
    });
  }
}

/**
 * In-memory cache for the Management API token. Auth0 issues these for the
 * full `expires_in` duration (typically 24h for M2M). We keyed it on the
 * mgmtClientId so a credential rotation invalidates automatically. A 60s
 * safety window guards against using a token that's about to expire.
 */
interface CachedToken {
  token: string;
  expiresAtMs: number;
  clientId: string;
}
let cachedToken: CachedToken | null = null;
const TOKEN_SAFETY_WINDOW_MS = 60_000;

/** Test-only: clear the cached Management API token. */
export function _resetManagementApiTokenCache(): void {
  cachedToken = null;
}

/**
 * Get a Management API access token via client_credentials grant. Caches the
 * token for its declared `expires_in` minus a 60s safety window so successive
 * password changes don't each pay a token-issuance round-trip and don't burn
 * the tenant's token-issuance rate budget unnecessarily.
 */
export async function getManagementApiToken(): Promise<string> {
  const config = loadConfig();

  if (
    cachedToken &&
    cachedToken.clientId === config.mgmtClientId &&
    Date.now() < cachedToken.expiresAtMs - TOKEN_SAFETY_WINDOW_MS
  ) {
    return cachedToken.token;
  }

  const res = await fetchAuth0(`${config.issuer}/oauth/token`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      grant_type: "client_credentials",
      client_id: config.mgmtClientId,
      client_secret: config.mgmtClientSecret,
      audience: config.audience,
    }),
  });

  const body = (await parseJsonSafe(res)) as
    | {
        access_token?: string;
        expires_in?: number;
        error?: string;
        error_description?: string;
      }
    | undefined;

  if (!res.ok || !body?.access_token) {
    throw new Auth0ApiError({
      status: res.status,
      code: "unknown",
      message:
        body?.error_description ??
        body?.error ??
        `Auth0 client_credentials grant failed with status ${res.status}`,
      body,
    });
  }

  // Auth0 always returns expires_in for client_credentials. Treat a missing
  // value defensively as "don't cache" rather than risking a stale token.
  if (typeof body.expires_in === "number" && body.expires_in > 0) {
    cachedToken = {
      token: body.access_token,
      expiresAtMs: Date.now() + body.expires_in * 1000,
      clientId: config.mgmtClientId,
    };
  } else {
    cachedToken = null;
  }

  return body.access_token;
}

/**
 * Update a user's password via Auth0 Management API.
 * Throws Auth0ApiError with code="insufficient_scope" when the Auth0
 * application lacks the `update:users` scope — callers should surface a
 * configuration error message to the operator.
 */
export async function updateUserPassword(args: {
  auth0UserId: string;
  newPassword: string;
  managementToken: string;
}): Promise<void> {
  const config = loadConfig();

  const url = `${config.issuer}/api/v2/users/${encodeURIComponent(args.auth0UserId)}`;
  const res = await fetchAuth0(url, {
    method: "PATCH",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${args.managementToken}`,
    },
    body: JSON.stringify({
      password: args.newPassword,
      connection: AUTH0_DB_CONNECTION,
    }),
  });

  if (res.ok) return;

  const body = (await parseJsonSafe(res)) as
    | { errorCode?: string; message?: string; error?: string }
    | undefined;

  // Auth0 attaches an explicit `errorCode` on Management API 403s.
  // Match on that — not just the HTTP status — so unrelated 403s (e.g.
  // a blocked user, an MFA-required step) don't get mis-labeled with a
  // scope-misconfiguration message and bad remediation advice.
  const errorCode = body?.errorCode ?? body?.error;
  if (errorCode === "insufficient_scope") {
    logger.error(
      { status: res.status, body },
      "Auth0 Management API rejected password update — missing update:users scope",
    );
    throw new Auth0ApiError({
      status: res.status,
      code: "insufficient_scope",
      message:
        "Auth0 Management API is not authorized to update users. Enable the 'update:users' scope on your Auth0 application.",
      body,
    });
  }

  logger.error(
    { status: res.status, body },
    "Auth0 Management API password update failed",
  );
  throw new Auth0ApiError({
    status: res.status,
    code: "unknown",
    message:
      body?.message ??
      body?.error ??
      `Auth0 Management API PATCH /users failed with status ${res.status}`,
    body,
  });
}

/**
 * Verify the user's current Auth0 password using Resource Owner Password
 * Grant against the Management M2M client. Returns:
 *   - `true`  on 200 (Auth0 minted a token, so the credentials are valid).
 *   - `false` if Auth0 returns `invalid_grant` (wrong email or password).
 * Throws Auth0ApiError for everything else — most importantly
 * `password_grant_not_enabled` when the M2M app's allowed grant types
 * doesn't include "Password", which is the operator-fixable misconfig.
 *
 * Why the M2M client and not the user-login (SPA) one: the SPA is a
 * public client (no secret) and Auth0 routes its grant types through
 * Universal Login by design. The M2M client is confidential and we
 * already use it for the Management API, so it's the natural place to
 * authorize the Password grant.
 */
export async function verifyCurrentPassword(args: {
  email: string;
  password: string;
}): Promise<boolean> {
  const config = loadConfig();

  const res = await fetchAuth0(`${config.issuer}/oauth/token`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      grant_type: "password",
      username: args.email,
      password: args.password,
      audience: config.audience,
      scope: "openid",
      client_id: config.mgmtClientId,
      client_secret: config.mgmtClientSecret,
    }),
  });

  if (res.ok) return true;

  const body = (await parseJsonSafe(res)) as
    | { error?: string; error_description?: string }
    | undefined;

  // Wrong email or password — Auth0 returns 403 with error=invalid_grant.
  if (body?.error === "invalid_grant") return false;

  // The M2M app doesn't have the Password grant enabled. Surface a
  // setup-fixable error so callers don't show "wrong password" when
  // the real problem is configuration.
  if (
    body?.error === "unauthorized_client" &&
    typeof body.error_description === "string" &&
    body.error_description.toLowerCase().includes("password")
  ) {
    logger.error(
      { status: res.status, body },
      "Auth0 Password grant is not enabled on the Management M2M application",
    );
    throw new Auth0ApiError({
      status: res.status,
      code: "password_grant_not_enabled",
      message:
        "Auth0 Password grant type is not enabled on the Management M2M application. Enable 'Password' under that application's Advanced Settings → Grant Types.",
      body,
    });
  }

  throw new Auth0ApiError({
    status: res.status,
    code: "unknown",
    message:
      body?.error_description ??
      body?.error ??
      `Auth0 /oauth/token (password) failed with status ${res.status}`,
    body,
  });
}

/**
 * Verify the user's current Auth0 password, then update it via the
 * Management API.
 *
 * Returns `{ ok: true }` on success, `{ ok: false, reason: "wrong_password" }`
 * when verification fails. Throws Auth0ApiError for non-credential failures
 * (config, scope, transport).
 *
 * Caller protections that backstop this:
 *   - Authenticated session (enforced by tRPC `protectedProcedure`).
 *   - 5 attempts per 15min per user rate limit (enforced in the router) —
 *     also guards against brute-forcing the current password through this
 *     entry point.
 */
export async function changeAuth0Password(args: {
  email: string;
  auth0UserId: string;
  currentPassword: string;
  newPassword: string;
}): Promise<{ ok: true } | { ok: false; reason: "wrong_password" }> {
  const verified = await verifyCurrentPassword({
    email: args.email,
    password: args.currentPassword,
  });
  if (!verified) return { ok: false, reason: "wrong_password" };

  const token = await getManagementApiToken();
  await updateUserPassword({
    auth0UserId: args.auth0UserId,
    newPassword: args.newPassword,
    managementToken: token,
  });

  return { ok: true };
}
