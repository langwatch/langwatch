import type { Amr } from "@langwatch/identity";
import { deriveSessionAmr, signInProviderForPath } from "./session-claims";

/**
 * What a session records at the moment it is minted (D06): which of the
 * person's sign-in methods minted it, and what that sign-in proved.
 *
 * A decision over two reads, both ports, so the write path can be tested
 * against the sign-ins that matter rather than against a database. Neither
 * port can end a session and neither can refuse one: this service answers
 * what to WRITE onto a row better-auth is about to create, and a failure
 * anywhere in it degrades to a session that recorded nothing - which is an
 * ordinary session, not a broken one.
 */

/** Which `Identifier` row a provider's sign-in belongs to, for this person. */
export interface SessionIdentifierPort {
  /**
   * The live identifier this person holds for `provider`, or null when the
   * projection has none - which is every user whose backfill has not
   * finalized, and is not an error.
   */
  findIdentifierIdFor(args: {
    userId: string;
    provider: string;
  }): Promise<string | null>;
}

/** What this person's identity provider asserted on the sign-in just made. */
export interface ProviderAssertionPort {
  /**
   * The `amr` values the provider asserted, read off the token it issued.
   * An empty answer is the common one and means exactly what it says: the
   * provider asserted nothing, so nothing is inferred on its behalf.
   */
  assertedFactorsFor(args: {
    userId: string;
    provider: string;
  }): Promise<readonly string[]>;
}

export interface SessionClaims {
  identifierId: string | null;
  amr: readonly Amr[];
}

export interface SessionClaimsServiceDeps {
  identifiers: SessionIdentifierPort;
  assertions: ProviderAssertionPort;
}

/** What a session that could not be attributed records: nothing at all. */
export const NO_SESSION_CLAIMS: SessionClaims = { identifierId: null, amr: [] };

export class SessionClaimsService {
  constructor(private readonly deps: SessionClaimsServiceDeps) {}

  /**
   * The claims for a session better-auth is about to mint on `path`.
   *
   * A path we do not recognize answers with nothing recorded rather than a
   * guess. That is the same value every pre-D06 session carries, so an
   * endpoint we have not taught this about degrades to the behaviour the
   * product had before any of it existed.
   */
  async claimsForMint({
    userId,
    path,
  }: {
    userId: string;
    path: string;
  }): Promise<SessionClaims> {
    const provider = signInProviderForPath({ path });
    if (!provider) return NO_SESSION_CLAIMS;

    // Only a federated sign-in can carry an assertion; asking on the
    // credential path would be a read with one possible answer.
    const providerAssertedAmr =
      provider === "credential" || provider === "passkey"
        ? []
        : await this.deps.assertions.assertedFactorsFor({ userId, provider });

    return {
      identifierId: await this.deps.identifiers.findIdentifierIdFor({
        userId,
        provider,
      }),
      amr: deriveSessionAmr({ path, providerAssertedAmr }),
    };
  }
}
