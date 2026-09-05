import { createLogger } from "@langwatch/observability";

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
  | "weak_password"
  | "unknown";

export class Auth0ApiError extends Error {
  readonly status: number;
  readonly code: Auth0ErrorCode;
  readonly body: unknown;

  constructor(args: { status: number; code: Auth0ErrorCode; message: string; body?: unknown }) {
    super(args.message);
    this.name = "Auth0ApiError";
    this.status = args.status;
    this.code = args.code;
    this.body = args.body;
  }
}

/**
 * The Auth0 tenant this deployment manages passwords in, as its environment spells it.
 */
export type Auth0ManagementCredentials = Readonly<{
  issuer: string | undefined;
  /**
   * Client ID for the Management API `client_credentials` grant.
   */
  mgmtClientId: string | undefined;
  /** Client secret for that same grant. Never logged, never reported. */
  mgmtClientSecret: string | undefined;
}>;

/** The tenant, once every value it needs is present. */
interface Auth0Config {
  issuer: string;
  mgmtClientId: string;
  mgmtClientSecret: string;
  audience: string;
}

/**
 * Validates the deployment's credentials, or refuses by name.
 */
function loadConfig(credentials: Auth0ManagementCredentials): Auth0Config {
  const { issuer, mgmtClientId, mgmtClientSecret } = credentials;
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
 * Hard cap on Auth0 HTTP calls. The default is "wait forever," which lets an upstream
 * stall hold a tRPC mutation hostage.
 */
const AUTH0_HTTP_TIMEOUT_MS = 10_000;

/**
 * Wrap `fetch` so that:
 */
async function fetchAuth0(url: string, init: Omit<RequestInit, "signal">): Promise<Response> {
  try {
    return await fetch(url, {
      ...init,
      signal: AbortSignal.timeout(AUTH0_HTTP_TIMEOUT_MS),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);

    throw new Auth0ApiError({
      status: 502,
      code: "unknown",
      message: `Auth0 request to ${url} failed before receiving a response: ${message}`,
      body: { transportError: message },
    });
  }
}

/**
 * In-memory cache for the Management API token. Auth0 issues these for the full
 * `expires_in` duration (typically 24h for M2M). We keyed it on the mgmtClientId so a
 * credential rotation invalidates automatically.
 */
interface CachedToken {
  token: string;
  expiresAtMs: number;
  clientId: string;
}
let cachedToken: CachedToken | null = null;
const TOKEN_SAFETY_WINDOW_MS = 60_000;

/**
 * Pull the operator-friendly message out of an Auth0 password-policy 400. Returns null if
 * the body isn't a recognizable policy error.
 */
function extractPasswordPolicyMessage(
  body: { errorCode?: string; message?: string; error?: string } | undefined,
): string | null {
  const message = body?.message;
  if (typeof message !== "string") {
    return null;
  }

  const policyPrefixes = [
    "PasswordStrengthError",
    "PasswordHistoryError",
    "PasswordDictionaryError",
    "PasswordNoUserInfoError",
  ];
  if (!policyPrefixes.some((p) => message.startsWith(p))) {
    return null;
  }

  // Strip the "PasswordStrengthError: " prefix so the user sees a clean
  // sentence ("Password is too weak.") instead of the type tag.
  const colonIdx = message.indexOf(":");
  const cleaned = colonIdx >= 0 ? message.slice(colonIdx + 1).trim() : message;

  return cleaned.length > 0
    ? `${cleaned} Please choose a stronger password (Auth0 tenant policy).`
    : "Auth0 rejected the new password as too weak. Please choose a stronger one.";
}

/** Auth0's Management API, as the password-change flows reach it. */
export class Auth0PasswordService {
  static create(): Auth0PasswordService {
    return new Auth0PasswordService();
  }

  /** Test-only: clear the cached Management API token. */
  static _resetManagementApiTokenCache(): void {
    cachedToken = null;
  }

  /**
   * Get a Management API access token via client_credentials grant.
   */
  static async getManagementApiToken(credentials: Auth0ManagementCredentials): Promise<string> {
    const config = loadConfig(credentials);

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
   * Update a user's password via Auth0 Management API. Throws Auth0ApiError with
   * code="insufficient_scope" when the Auth0 application lacks the `update:users` scope —
   * callers should surface a configuration error message to the operator.
   */
  static async updateUserPassword(args: {
    credentials: Auth0ManagementCredentials;
    auth0UserId: string;
    newPassword: string;
    managementToken: string;
  }): Promise<void> {
    const config = loadConfig(args.credentials);

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

    if (res.ok) {
      return;
    }

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

    // Tenant password policy rejected the new password (length, char classes,
    // history, dictionary, etc). Auth0 returns 400 with a PasswordStrengthError
    // / PasswordHistoryError / PasswordDictionaryError / PasswordNoUserInfoError
    // message — surface it directly so the user knows what to fix instead of
    // seeing "Could not update password. Please try again later."
    const policyMessage = extractPasswordPolicyMessage(body);
    if (policyMessage) {
      logger.warn(
        { status: res.status, body },
        "Auth0 Management API rejected new password (tenant policy)",
      );

      throw new Auth0ApiError({
        status: res.status,
        code: "weak_password",
        message: policyMessage,
        body,
      });
    }

    logger.error({ status: res.status, body }, "Auth0 Management API password update failed");

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
   * Verify the user's current Auth0 password using Resource Owner Password Grant against the
   * Management M2M client. Returns:
   */
  static async verifyCurrentPassword(args: {
    credentials: Auth0ManagementCredentials;
    email: string;
    password: string;
  }): Promise<boolean> {
    const config = loadConfig(args.credentials);

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

    if (res.ok) {
      return true;
    }

    const body = (await parseJsonSafe(res)) as
      | { error?: string; error_description?: string }
      | undefined;

    // Wrong email or password — Auth0 returns 403 with error=invalid_grant.
    if (body?.error === "invalid_grant") {
      return false;
    }

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
   * Verify the user's current Auth0 password, then update it via the Management API.
   */
  static async changeAuth0Password(args: {
    credentials: Auth0ManagementCredentials;
    email: string;
    auth0UserId: string;
    currentPassword: string;
    newPassword: string;
  }): Promise<{ ok: true } | { ok: false; reason: "wrong_password" }> {
    const verified = await Auth0PasswordService.verifyCurrentPassword({
      credentials: args.credentials,
      email: args.email,
      password: args.currentPassword,
    });
    if (!verified) {
      return { ok: false, reason: "wrong_password" };
    }

    const token = await Auth0PasswordService.getManagementApiToken(args.credentials);
    await Auth0PasswordService.updateUserPassword({
      credentials: args.credentials,
      auth0UserId: args.auth0UserId,
      newPassword: args.newPassword,
      managementToken: token,
    });

    return { ok: true };
  }
}
