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
    providerId: string;
    providerAccountId?: string;
  }): Promise<string | null>;
}

export interface AuthenticatedProviderAccount {
  providerAccountId: string;
  assertedFactors: readonly string[];
  verifiedTokenClaims: boolean;
}

/** The provider account and factors proved by this request's callback. */
export interface ProviderAssertionPort {
  /**
   * The account and `amr` values BetterAuth verified in the callback currently
   * minting this session. Null means there is no callback evidence in this
   * request, so neither an account nor a factor may be inferred.
   */
  authenticatedAccountFor(args: {
    providerId: string;
  }): Promise<AuthenticatedProviderAccount | null>;
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

    const isLocal = provider === "credential" || provider === "passkey";
    const authenticatedAccount = isLocal
      ? null
      : await this.deps.assertions.authenticatedAccountFor({
          providerId: provider,
        });

    // A callback path alone proves nothing. Without current verified evidence
    // even the protocol label is omitted, so a stale Account token cannot
    // turn an otherwise empty session into one that appears provider-backed.
    if (!isLocal && !authenticatedAccount) return NO_SESSION_CLAIMS;

    // A federated session is attributed only when this request carried the
    // exact accepted provider account. Falling back to "the newest account
    // for this provider" would let a concurrent or stale callback stamp a
    // session with somebody else's sign-in evidence.
    const identifierId = await this.deps.identifiers.findIdentifierIdFor({
      userId,
      providerId: provider,
      ...(authenticatedAccount
        ? { providerAccountId: authenticatedAccount.providerAccountId }
        : {}),
    });

    return {
      identifierId,
      amr:
        isLocal || authenticatedAccount?.verifiedTokenClaims
          ? deriveSessionAmr({
              path,
              providerAssertedAmr: authenticatedAccount?.assertedFactors ?? [],
            })
          : [],
    };
  }
}
