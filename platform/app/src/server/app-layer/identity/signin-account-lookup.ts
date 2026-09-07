import {
  type AccountSignInMethods,
  isLiveIdentifierState,
} from "@langwatch/identity";
import type {
  IdentityHeadsRepository,
  SignInAccountLookupPort,
} from "@langwatch/identity-server";

/**
 * What the address's account holds, for the sign-in router (ADR-117, revision
 * 2026-08-25).
 *
 * Built entirely on the identifier projection, over the repository the guards
 * and ceremonies already read: `findActiveIdentifierByValue` answers whether
 * anybody holds the address, and `findHeads` answers what else that person
 * holds. Nothing new is queried and no new index is needed — the two reads are
 * the ones D01 already put in place.
 *
 * ── What it deliberately does not read ──────────────────────────────────
 *
 * `AccountCredential`, and by extension `Account.password`. A password is
 * present in the projection as an identifier whose provider is `credential`,
 * and that row is the fact the screen needs: "this account can sign in with a
 * password". Reading the secrets table to answer it would put a hashed
 * credential one destructuring away from a decision object that a public,
 * unauthenticated endpoint returns.
 *
 * ── Why only live identifiers count ─────────────────────────────────────
 *
 * A detached identifier is a method somebody REMOVED. Offering it back would
 * be the screen contradicting a settings page, and worse, it would offer a way
 * in that no longer works. `isLiveIdentifierState` is the same predicate the
 * rest of the identity surface filters on, imported rather than restated.
 */
export class ProjectionSignInAccountLookup implements SignInAccountLookupPort {
  constructor(private readonly heads: IdentityHeadsRepository) {}

  async findAccountMethods({
    normalizedValue,
  }: {
    normalizedValue: string;
  }): Promise<AccountSignInMethods | null> {
    const holder = await this.heads.findActiveIdentifierByValue({
      normalizedValue,
    });
    // Nobody holds the address. The routing answer, not an error: it is what
    // sends somebody to sign-up rather than to a credential box.
    if (!holder) return null;

    const heads = await this.heads.findHeads({ userId: holder.userId });
    const live = Object.values(heads.identifiers).filter((identifier) =>
      isLiveIdentifierState(identifier.state),
    );

    return {
      hasPassword: live.some(
        (identifier) => identifier.provider === "credential",
      ),
      hasPasskey: live.some((identifier) => identifier.provider === "passkey"),
      // Deduplicated, because one connection can back several identifiers for
      // the same person — a work address and an alias on the same provider —
      // and the router ranks connections, not rows.
      connectionIds: [
        ...new Set(
          live
            .map((identifier) => identifier.connectionId)
            .filter((id): id is string => id !== null),
        ),
      ],
    };
  }
}
