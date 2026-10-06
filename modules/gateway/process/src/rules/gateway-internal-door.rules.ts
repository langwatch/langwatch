/** The internal door's `{ status, body }` envelope, as main answered it; key status refusals. */
import type { Instant } from "@langwatch/time";

type RefusalStatus = 400 | 401 | 403 | 404 | 429 | 501 | 503;
type Refusal = { type: string; code: string; message: string } & Record<string, unknown>;

export function answer<const Body>(body: Body): { status: 200; body: Body } {
  return { status: 200 as const, body };
}

export function refuse<Status extends RefusalStatus>(
  status: Status,
  error: Refusal,
): { status: Status; body: { error: Refusal } } {
  return { status, body: { error } };
}

/** The body a route reads for itself, or `null` when the bytes were not JSON. */
export function readJson(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/** Why a presented virtual key is refused, with the code a caller branches on. */
export interface KeyAuthRejection {
  status: 401 | 403;
  type: string;
  code: string;
  message: string;
}

/** Null if the key may serve; each rejection carries its own code so callers can branch on it. */
export function detectVirtualKeyStatusRejection({
  status,
  expiresAt,
  now,
}: {
  status: string;
  expiresAt: Instant | null;
  now: Instant;
}): KeyAuthRejection | null {
  if (status === "REVOKED") {
    return {
      status: 403,
      type: "virtual_key_revoked",
      code: "virtual_key_revoked",
      message: "virtual key has been revoked",
    };
  }
  if (status === "DISABLED") {
    return {
      status: 403,
      type: "virtual_key_disabled",
      code: "virtual_key_disabled",
      message: "virtual key is disabled; it can be re-enabled by an administrator",
    };
  }
  if (expiresAt && expiresAt.epochMilliseconds <= now.epochMilliseconds) {
    return {
      status: 403,
      type: "virtual_key_expired",
      code: "virtual_key_expired",
      message: "virtual key has expired; extend its expiration or mint a new one",
    };
  }
  return null;
}
