import { type Instant, nowInstant } from "@langwatch/time";
/**
 * Short-lived JWT (contract §4.1) the control-plane issues after resolving a
 * VK; TTL is 15 minutes or the key's own expiration, whichever comes first.
 * `project_id`/`team_id` are nullable post-collapse, falling back to span-export skip.
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
  /** The hosted services a resolved license token is entitled to (ADR-156). A plain virtual
   *  key omits the claim and a license entitled to nothing sends `[]`: omitted, not null,
   *  because null would decode the same way the empty array does. */
  connect_services?: string[];
};

/** What a caller hands the signer: the identity claims, plus the key's own
 *  expiration as an instant. The `vk_expires_at` claim is derived here so
 *  one place decides both the claim and the token lifetime it bounds. */
export type GatewayJwtSubject = Omit<GatewayJwtClaims, "vk_expires_at"> & {
  notAfter?: Instant | null;
};

/**
 * The signing identity, held per instance rather than read from the
 * environment on every call: the process parses `LW_GATEWAY_JWT_SECRET`
 * once and hands it here. Never logged, never returned.
 */
export class GatewayJwtService {
  static create(options: { secret: string }): GatewayJwtService {
    if (!options.secret) {
      throw new Error("a gateway JWT signing secret is required to sign gateway-facing JWTs");
    }
    return new GatewayJwtService(options.secret);
  }

  private constructor(private readonly secret: string) {}

  /** Mints the gateway token, ending at the 15 minute TTL or the key's
   *  expiration, whichever comes first. A caller skipping the resolve-key
   *  expiry check still gets a one-second floor rather than `exp <= iat`,
   *  since some verifiers reject that as malformed rather than expired. */
  sign({ notAfter, ...identity }: GatewayJwtSubject): {
    jwt: string;
    expiresAt: number;
  } {
    const secret = this.secret;
    const issuedAt = Math.floor(nowInstant().epochMilliseconds / 1000);
    const keyExpiresAt = notAfter ? Math.floor(notAfter.epochMilliseconds / 1000) : null;
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
      ...(payload.connect_services ? { connect_services: payload.connect_services } : {}),
    };
  }
}
