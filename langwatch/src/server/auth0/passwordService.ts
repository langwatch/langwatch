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
 * Get a Management API access token via client_credentials grant.
 * Token is not cached in v1 — one extra call per password change is fine.
 */
export async function getManagementApiToken(): Promise<string> {
  const config = loadConfig();

  const res = await fetch(`${config.issuer}/oauth/token`, {
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
    | { access_token?: string; error?: string; error_description?: string }
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
  const res = await fetch(url, {
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

  const errorCode = body?.errorCode ?? body?.error;
  if (res.status === 403 || errorCode === "insufficient_scope") {
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
 * Set a user's Auth0 password directly via the Management API. The user's
 * authenticated app session is trusted as proof of identity — current
 * password is NOT verified against Auth0 (modern Auth0 tenants phase out
 * the Resource Owner Password Grant required for that, and dashboard
 * configuration of Password grant is not exposed in newer Auth0 UIs).
 *
 * Caller protections:
 *   - Authenticated session required (enforced by tRPC `protectedProcedure`).
 *   - 5 attempts per 15 min per user rate limit (enforced in the router).
 */
export async function changeAuth0Password(args: {
  auth0UserId: string;
  newPassword: string;
}): Promise<void> {
  const token = await getManagementApiToken();
  await updateUserPassword({
    auth0UserId: args.auth0UserId,
    newPassword: args.newPassword,
    managementToken: token,
  });
}
