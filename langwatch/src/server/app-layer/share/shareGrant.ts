/**
 * Short-lived viewing grant for an anonymous share viewer.
 *
 * `share.resolve` exchanges a share token for one of these after validating
 * expiry / view-cap / audience. It is carried as an httpOnly cookie, so every
 * subsequent tRPC read from the share page presents it automatically and the
 * rbac middleware can authorize on grant possession rather than on the
 * (guessable) resource id. The grant is scoped to a single resource — its
 * claims lock it to one project + resource id — so it is not a broad session.
 *
 * Signed HS256 with NEXTAUTH_SECRET (always present at runtime), mirroring
 * src/server/gateway/gatewayJwt.ts. See ADR-039.
 */
import jwt from "jsonwebtoken";

import { env } from "~/env.mjs";

const ISSUER = "langwatch-control-plane";
const AUDIENCE = "langwatch-share";
export const SHARE_GRANT_TTL_SECONDS = 30 * 60;
export const SHARE_GRANT_COOKIE = "lw_share_grant";

export type ShareGrantClaims = {
  share_id: string;
  project_id: string;
  resource_type: "TRACE" | "THREAD";
  resource_id: string;
  thread_id: string | null;
};

function getSecret(): string {
  const secret = process.env.NEXTAUTH_SECRET ?? env.NEXTAUTH_SECRET;
  if (!secret) {
    throw new Error("NEXTAUTH_SECRET is required to sign share grants");
  }
  return secret;
}

export function signShareGrant(claims: ShareGrantClaims): {
  jwt: string;
  expiresAt: number;
} {
  const secret = getSecret();
  const expiresAt = Math.floor(Date.now() / 1000) + SHARE_GRANT_TTL_SECONDS;
  const signedJwt = jwt.sign(claims, secret, {
    algorithm: "HS256",
    issuer: ISSUER,
    audience: AUDIENCE,
    expiresIn: SHARE_GRANT_TTL_SECONDS,
  });
  return { jwt: signedJwt, expiresAt };
}

/** Returns the grant claims if the token is a valid, unexpired share grant, else null. */
export function verifyShareGrant(token: string): ShareGrantClaims | null {
  try {
    const secret = getSecret();
    const payload = jwt.verify(token, secret, {
      algorithms: ["HS256"],
      issuer: ISSUER,
      audience: AUDIENCE,
    }) as ShareGrantClaims & { iat: number; exp: number };
    return {
      share_id: payload.share_id,
      project_id: payload.project_id,
      resource_type: payload.resource_type,
      resource_id: payload.resource_id,
      thread_id: payload.thread_id ?? null,
    };
  } catch {
    return null;
  }
}

/**
 * Reads and verifies the grant from a raw `Cookie` request header. The HTTP
 * transport is the tRPC fetch adapter behind Hono, whose request shim exposes
 * only headers — there is no parsed `.cookies` map to read.
 */
export function readShareGrantFromCookieHeader(
  cookieHeader: string | null | undefined,
): ShareGrantClaims | null {
  if (!cookieHeader) return null;
  for (const part of cookieHeader.split(";")) {
    const separator = part.indexOf("=");
    if (separator === -1) continue;
    const name = part.slice(0, separator).trim();
    if (name !== SHARE_GRANT_COOKIE) continue;
    return verifyShareGrant(part.slice(separator + 1).trim());
  }
  return null;
}

/** Serializes the Set-Cookie header value carrying a signed grant. */
export function buildShareGrantCookie(signedJwt: string): string {
  const parts = [
    `${SHARE_GRANT_COOKIE}=${signedJwt}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${SHARE_GRANT_TTL_SECONDS}`,
  ];
  if (process.env.NODE_ENV === "production") {
    parts.push("Secure");
  }
  return parts.join("; ");
}
