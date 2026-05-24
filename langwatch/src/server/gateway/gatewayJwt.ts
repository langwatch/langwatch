/**
 * Short-lived JWT that the control-plane issues after resolving a VK and
 * the Go gateway verifies on every public request.
 *
 * Claims (per contract §4.1):
 *   { vk_id, project_id, team_id, org_id, principal_id, revision, exp,
 *     iat, iss, aud }
 *
 * `project_id` + `team_id` are nullable post-collapse: a VK can be scoped
 * at ORGANIZATION or TEAM, in which case the gateway falls back to the
 * org's `internal_governance` project (if any) for span export. When even
 * that fallback is unavailable (older self-hosted deploys), both fields
 * are null and the gateway skips span export.
 *
 * TTL: 15 minutes. Gateway refreshes at T+10 min asynchronously.
 */
import jwt from "jsonwebtoken";

import { env } from "~/env.mjs";

const ISSUER = "langwatch-control-plane";
const AUDIENCE = "langwatch-gateway";
const TTL_SECONDS = 15 * 60;

export type GatewayJwtClaims = {
  vk_id: string;
  project_id: string | null;
  team_id: string | null;
  org_id: string;
  principal_id: string | null;
  revision: string;
};

function getSecret(): string {
  const secret =
    process.env.LW_GATEWAY_JWT_SECRET ?? env.LW_GATEWAY_JWT_SECRET;
  if (!secret) {
    throw new Error(
      "LW_GATEWAY_JWT_SECRET is required to sign gateway-facing JWTs",
    );
  }
  return secret;
}

export function signGatewayJwt(claims: GatewayJwtClaims): {
  jwt: string;
  expiresAt: number;
} {
  const secret = getSecret();
  const expiresAt = Math.floor(Date.now() / 1000) + TTL_SECONDS;
  const signedJwt = jwt.sign(claims, secret, {
    algorithm: "HS256",
    issuer: ISSUER,
    audience: AUDIENCE,
    expiresIn: TTL_SECONDS,
  });
  return { jwt: signedJwt, expiresAt };
}

export function verifyGatewayJwt(token: string): GatewayJwtClaims {
  const secret = getSecret();
  const payload = jwt.verify(token, secret, {
    algorithms: ["HS256"],
    issuer: ISSUER,
    audience: AUDIENCE,
  }) as GatewayJwtClaims & { iat: number; exp: number };
  return {
    vk_id: payload.vk_id,
    project_id: payload.project_id,
    team_id: payload.team_id,
    org_id: payload.org_id,
    principal_id: payload.principal_id,
    revision: payload.revision,
  };
}

