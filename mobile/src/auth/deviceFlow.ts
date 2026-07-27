import type { StoredSession } from "@/lib/session";

/**
 * The RFC 8628 device-authorization grant, as served by
 * `langwatch/src/server/routes/auth-cli.ts`.
 *
 * The app never sees a password: it asks for a device code, sends the operator
 * to the instance's own sign-in page to approve it, and polls until tokens come
 * back. That also means SSO, MFA and whatever else the instance enforces at the
 * browser stay enforced — this client cannot bypass any of it because it never
 * handles the credential.
 *
 * Wire format is snake_case JSON to match RFC 8628.
 */

export interface DeviceChallenge {
  deviceCode: string;
  /** The short code shown to the operator, e.g. "WDJB-MJHT". */
  userCode: string;
  /** Where to send them. Already carries the user code as a query parameter. */
  verificationUrl: string;
  /** Unix milliseconds. */
  expiresAt: number;
  /** Minimum seconds between polls; the server rate-limits below this. */
  pollIntervalSeconds: number;
}

export type DeviceFlowFailureKind =
  /** The operator has not approved yet. Keep polling. */
  | "authorization_pending"
  /** Polled too fast; back off and retry. */
  | "slow_down"
  /** The device code expired before it was approved. */
  | "expired"
  /** The operator explicitly declined in the browser. */
  | "denied"
  /** The refresh token is unknown or revoked — sign out. */
  | "refresh_rejected"
  | "server";

export class DeviceFlowError extends Error {
  constructor(
    readonly kind: DeviceFlowFailureKind,
    message: string,
  ) {
    super(message);
    this.name = "DeviceFlowError";
  }
}

export async function requestDeviceCode(
  instance: string,
): Promise<DeviceChallenge> {
  const response = await postJson(instance, "/api/auth/cli/device-code", {});
  const body = response as {
    device_code: string;
    user_code: string;
    verification_uri_complete: string;
    expires_in: number;
    interval: number;
  };

  return {
    deviceCode: body.device_code,
    userCode: body.user_code,
    verificationUrl: body.verification_uri_complete,
    expiresAt: Date.now() + body.expires_in * 1000,
    pollIntervalSeconds: body.interval,
  };
}

/**
 * One poll. Throws `authorization_pending` while the operator has not yet
 * approved — the caller loops on that, honouring `pollIntervalSeconds`.
 */
export async function exchangeDeviceCode({
  instance,
  deviceCode,
  deviceLabel,
}: {
  instance: string;
  deviceCode: string;
  deviceLabel: string;
}): Promise<StoredSession> {
  const response = await postJson(instance, "/api/auth/cli/exchange", {
    device_code: deviceCode,
    client_info: { device_label: deviceLabel, platform: "ios" },
  });
  const body = response as {
    access_token: string;
    expires_in: number;
    refresh_token: string;
    user: { id: string; email: string | null; name: string | null };
    organization: { id: string; name: string };
  };

  return {
    instance,
    accessToken: body.access_token,
    refreshToken: body.refresh_token,
    accessTokenExpiresAt: Date.now() + body.expires_in * 1000,
    userId: body.user.id,
    userEmail: body.user.email ?? null,
    userName: body.user.name ?? null,
    organizationName: body.organization.name ?? null,
  };
}

/**
 * Trade the refresh token for a fresh pair. The server rotates the refresh
 * token on every call, so the returned session must replace the stored one
 * atomically — see `sessionStore`, which serializes refreshes for exactly this
 * reason.
 */
export async function refreshSession(
  session: StoredSession,
): Promise<StoredSession> {
  const response = await postJson(session.instance, "/api/auth/cli/refresh", {
    refresh_token: session.refreshToken,
  });
  const body = response as {
    access_token: string;
    expires_in: number;
    refresh_token: string;
  };

  return {
    ...session,
    accessToken: body.access_token,
    refreshToken: body.refresh_token,
    accessTokenExpiresAt: Date.now() + body.expires_in * 1000,
  };
}

async function postJson(
  instance: string,
  path: string,
  body: unknown,
): Promise<unknown> {
  let response: Response;
  try {
    response = await fetch(`${instance}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch (error) {
    throw new DeviceFlowError(
      "server",
      `Could not reach the instance. ${
        error instanceof Error ? error.message : "Unknown network error"
      }`,
    );
  }

  const text = await response.text();
  const parsed = safeParse(text);

  if (response.ok) return parsed ?? {};

  throw toDeviceFlowError(response.status, parsed);
}

function safeParse(text: string): Record<string, unknown> | null {
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    return null;
  }
}

/**
 * Map the RFC 8628 error codes onto the cases the sign-in loop branches on.
 * The status codes come straight from the server's own table: 428 pending, 429
 * slow down, 408 expired, 410 denied, 401 refresh rejected. The error code in
 * the body is checked as well, so a proxy that rewrote the status does not turn
 * a pending approval into a hard failure.
 */
export function toDeviceFlowError(
  status: number,
  body: Record<string, unknown> | null,
): DeviceFlowError {
  const code = typeof body?.error === "string" ? body.error : undefined;
  const description =
    typeof body?.error_description === "string"
      ? body.error_description
      : undefined;

  const byStatus: Record<number, DeviceFlowFailureKind> = {
    428: "authorization_pending",
    429: "slow_down",
    408: "expired",
    410: "denied",
    401: "refresh_rejected",
  };
  const byCode: Record<string, DeviceFlowFailureKind> = {
    authorization_pending: "authorization_pending",
    slow_down: "slow_down",
    expired_token: "expired",
    access_denied: "denied",
    invalid_grant: "refresh_rejected",
  };

  const kind = byStatus[status] ?? (code ? byCode[code] : undefined);
  if (kind) return new DeviceFlowError(kind, describe(kind, description));

  return new DeviceFlowError(
    "server",
    description ?? `Sign-in failed (HTTP ${status})`,
  );
}

function describe(kind: DeviceFlowFailureKind, fallback?: string): string {
  switch (kind) {
    case "authorization_pending":
      return "Waiting for approval.";
    case "slow_down":
      return "Checking too often.";
    case "expired":
      return "The sign-in request expired. Start again.";
    case "denied":
      return "Sign-in was declined.";
    case "refresh_rejected":
      return "This session is no longer valid. Sign in again.";
    case "server":
      return fallback ?? "Sign-in failed.";
  }
}
