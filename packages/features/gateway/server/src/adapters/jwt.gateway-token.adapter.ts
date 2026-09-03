/**
 * Short-lived JWT that the control-plane issues after resolving a VK and
 * the Go gateway verifies on every public request.
 *
 * Claims (per contract §4.1):
 *   { vk_id, project_id, team_id, org_id, principal_id, revision,
 *     vk_expires_at, exp, iat, iss, aud }
 *
 * `project_id` + `team_id` are nullable post-collapse: a VK can be scoped
 * at ORGANIZATION or TEAM, in which case the gateway falls back to the
 * org's `internal_governance` project (if any) for span export. When even
 * that fallback is unavailable (older self-hosted deploys), both fields
 * are null and the gateway skips span export.
 *
 * TTL: 15 minutes, or the key's own expiration date when that comes first.
 * Gateway refreshes at T+10 min asynchronously.
 */
import jwt from "jsonwebtoken";

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
  /** Unix seconds at which the key itself stops being valid, null when the
   *  key has no expiration date. The gateway caps its auth-cache deadlines at
   *  this instant, so a key that runs out stops serving on schedule even while
   *  the control plane is unreachable. */
  vk_expires_at: number | null;
};

/** What a caller hands the signer: the identity claims, plus the key's own
 *  expiration date as a `Date`. The `vk_expires_at` claim is derived here so
 *  one place decides both the claim and the token lifetime it bounds. */
export type GatewayJwtSubject = Omit<GatewayJwtClaims, "vk_expires_at"> & {
  notAfter?: Date | null;
};

/**
 * The signing identity, held per instance rather than read from the
 * environment on every call: the process parses `LW_GATEWAY_JWT_SECRET` once
 * through its own configuration and hands it here. It is never logged and
 * never returned.
 */
export class GatewayJwtAdapter {
  static create(options: { secret: string }): GatewayJwtAdapter {
    if (!options.secret) {
      throw new Error("a gateway JWT signing secret is required to sign gateway-facing JWTs");
    }
    return new GatewayJwtAdapter(options.secret);
  }

  private constructor(private readonly secret: string) {}

  /** Mints the gateway token. The token ends at the 15 minute TTL or at the
   *  key's expiration date, whichever comes first, so no token can authorize a
   *  request after the key it was minted for has run out.
   *
   *  A date already in the past never reaches here: resolve-key refuses an
   *  expired key before it mints anything. If a caller skips that check the
   *  token still gets a positive lifetime, the one second floor below, because a
   *  token with `exp <= iat` is rejected by some verifiers as malformed rather
   *  than as expired, and "expired" is the answer the customer needs. */
  sign({ notAfter, ...identity }: GatewayJwtSubject): {
    jwt: string;
    expiresAt: number;
  } {
    const secret = this.secret;
    const issuedAt = Math.floor(Date.now() / 1000);
    const keyExpiresAt = notAfter ? Math.floor(notAfter.getTime() / 1000) : null;
    const ttlExpiresAt = issuedAt + TTL_SECONDS;
    const expiresAt = Math.max(
      issuedAt + 1,
      keyExpiresAt === null ? ttlExpiresAt : Math.min(ttlExpiresAt, keyExpiresAt),
    );
    const claims: GatewayJwtClaims = {
      ...identity,
      vk_expires_at: keyExpiresAt,
    };
    const signedJwt = jwt.sign({ ...claims, exp: expiresAt }, secret, {
      algorithm: "HS256",
      issuer: ISSUER,
      audience: AUDIENCE,
    });
    return { jwt: signedJwt, expiresAt };
  }

  verify(token: string): GatewayJwtClaims {
    const secret = this.secret;
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
      vk_expires_at: payload.vk_expires_at ?? null,
    };
  }
}
