import type { AttachIdentifierCommandData } from "@langwatch/identity";
import { newIdentityCommandId } from "@langwatch/identity-server";
import { issuerForProviderId } from "@langwatch/identity-server/better-auth";
import { createLogger } from "@langwatch/observability";

const logger = createLogger("langwatch:identity:sign-up-identifier");

/**
 * The one identity write a password sign-up owes (ADR-117 §6, ADR-101 §3).
 *
 * ## Why this exists at all
 *
 * The front door reads the identifier projection and nothing else: an address
 * no `Identifier` row carries is an address nobody holds, and the router
 * answers `route_to_signup` / `identifier_unknown` for it. Every other way an
 * account is made states its identifiers on the way through — better-auth's
 * sign-up routes through the storage adapter, whose account create runs
 * `beforeAccountCreate`; the backfill adopts existing users; the born-
 * finalized entrance bears newborns.
 *
 * The product's own sign-up page does not. It posts to `api.user.register`,
 * which writes `User` and `Account` through Prisma directly, so no ceremony
 * ever sees the write. That was a documented, harmless deferral while the
 * legacy screens were still mounted — the backfill adopted the user on its
 * next pass and sign-in worked from the legacy rows in the meantime. With
 * the identifier-first door as the only door, the same gap means: sign up,
 * confirm the address, and then be told no account exists for it.
 *
 * So the sign-up path states the identifier its `Account` row implies. That
 * is all this does — one attach, for the row the caller just wrote.
 *
 * ## Why it converges with the backfill rather than racing it
 *
 * The identifier id is a function of `(userId, provider, providerAccountId,
 * value, occurredAt)`, and the backfill derives `occurredAt` from
 * `Account.createdAt` and links by `Account.id`. So the caller passes the
 * committed row's OWN id and timestamp rather than "now": the fact this
 * states and the fact the backfill would later state are then the same fact,
 * and the event store dedupes instead of the projection carrying two rows for
 * one credential. Passing `Date.now()` here would quietly produce the second
 * row, which is why the timestamp is a parameter and not a default.
 *
 * ## Why a failure does not fail the sign-up
 *
 * By the time this runs the account rows are committed and the customer has
 * an account. Throwing would report a failed sign-up for an account that
 * exists, which is the one outcome worse than the gap this closes — the
 * person would sign up again and collide with their own address. A staging
 * failure means the engine is down, and the backfill's next pass adopts the
 * user exactly as it did before this existed, so the degraded state is the
 * old behaviour rather than a new one. It is logged at error because nothing
 * else marks it.
 */
export interface SignUpIdentifierWrites {
  attachIdentifier(input: AttachIdentifierCommandData): Promise<unknown>;
}

export class SignUpIdentifierService {
  constructor(private readonly identity: SignUpIdentifierWrites) {}

  /**
   * States the credential identifier for an `Account` row sign-up just wrote.
   *
   * `provider: "credential"` is what the router reads to offer a password
   * (`ProjectionSignInAccountLookup` checks exactly that), and `value` is
   * what makes the address resolvable at all, so one row answers both halves
   * of the routing question.
   */
  async attachCredentialIdentifier({
    userId,
    email,
    accountId,
    occurredAtMs,
  }: {
    userId: string;
    email: string;
    /** The committed `Account` row's id — the backfill links by it. */
    accountId: string;
    /** The committed `Account` row's `createdAt`, in millis. */
    occurredAtMs: number;
  }): Promise<void> {
    try {
      await this.identity.attachIdentifier({
        tenantId: userId,
        userId,
        commandId: newIdentityCommandId(),
        accountId,
        provider: "credential",
        // better-auth's own provider id, which is what the `Account` row
        // carries and what the projection is keyed by.
        providerId: "credential",
        issuer: issuerForProviderId("credential"),
        // The credential row names the user as its own subject, the same way
        // `createCredentialUser` writes it.
        providerAccountId: userId,
        value: email,
        occurredAtMs,
        ceremony: { flow: "sign-up" },
        actor: { type: "user", id: userId },
      });
    } catch (error) {
      logger.error(
        { error, userId },
        "sign-up could not state the credential identifier; the account exists and the backfill adopts it on its next pass",
      );
    }
  }
}
