import type { BetterAuthOptions } from "better-auth";
import type { BetterAuthDatabaseHooks } from "../hooks";
import type { SessionClaimsPort } from "../session-claims-hook";
import { sessionClaimsData } from "../session-claims-hook";

/** ADR-101 §2's erasure, taken before the user row goes. */
export interface UserErasureCeremonyPort {
  beforeUserDelete(user: { id?: unknown }): Promise<void>;
}

/**
 * The `Account` fields the two account ceremonies read. Structural, and
 * declared here rather than imported: better-auth reaches identity only
 * through the composition root (ADR-115), and a type import from the identity
 * server package is the same edge in the dependency graph as a value one.
 */
export interface CeremonyAccountRow {
  id?: unknown;
  userId?: unknown;
  providerId?: unknown;
  issuer?: unknown;
  accountId?: unknown;
  createdAt?: unknown;
}

/** The two account ceremonies `databaseHooks` binds (ADR-116 §5). */
export interface AccountCeremoniesPort {
  beforeAccountCreate(
    account: CeremonyAccountRow,
  ): Promise<{ data: { id: string } } | undefined>;
  beforeAccountDelete(account: CeremonyAccountRow): Promise<void>;
}

export interface DatabaseHooksDeps {
  /**
   * The nine hooks as one class (ADR-129). Resolved per call rather than
   * captured, because the services behind it reach ledgers that resolve the
   * pipeline handle when they run, and better-auth builds its options at
   * module load, before any App exists.
   */
  hooks: () => BetterAuthDatabaseHooks;
  /** The erasure a user delete is (ADR-101 §2). */
  userErasure: () => UserErasureCeremonyPort;
  /**
   * The two account ceremonies as the BRIDGE binds them (ADR-116 §5): the
   * same instances, deferring for every user the storage adapter routes to
   * the identity branch, because the adapter states those facts itself and a
   * second statement in the same request appends the event twice.
   */
  accountCeremonies: () => AccountCeremoniesPort;
  /** What a session records at mint: the identifier, and what was proved. */
  sessionClaims: () => SessionClaimsPort;
}

/**
 * better-auth's `databaseHooks:` entry, bound to the class that answers them.
 *
 * The binding is the only thing here: every hook translates better-auth's row
 * into a call on a service above, which is what makes "a hook that wants a row
 * has nothing to ask but a service" a property of the type rather than a
 * review comment.
 */
export function databaseHooks({
  hooks,
  userErasure,
  accountCeremonies,
  sessionClaims,
}: DatabaseHooksDeps): BetterAuthOptions["databaseHooks"] {
  return {
    user: {
      create: {
        before: async (user) =>
          hooks().beforeUserCreate({
            user: user as {
              email: string;
              deactivatedAt?: Date | null;
            } & Record<string, unknown>,
          }),
        after: async (user) => {
          await hooks().afterUserCreate({
            user: user as { id: string; email: string; name: string },
          });
        },
      },
      delete: {
        /**
         * ADR-101 §2: a user delete is an ERASURE, and erasure is what wipes
         * `Identifier.value` and `identifierHash`. Before the row goes, so a
         * refused ceremony refuses the delete with it; a no-op for users
         * whose backfill has not latched.
         */
        before: async (user) => {
          await userErasure().beforeUserDelete(user);
        },
      },
    },
    account: {
      create: {
        before: async (account) => {
          await hooks().beforeAccountCreate({
            account: {
              userId: account.userId,
              providerId: account.providerId,
              accountId: account.accountId,
            },
          });
          // ADR-101 §2: the account row is an identifier attach. Returning
          // the row data pins its id, which is what makes the live
          // identifier id and the backfill's derived id the same id.
          //
          // The BRIDGE ceremonies, not the bare ones (ADR-116 §5): the
          // storage adapter states this fact itself for every user it routes
          // to the identity branch, and a hook that stated it too would
          // append the event twice whenever the first fold had not landed.
          return accountCeremonies().beforeAccountCreate(account);
        },
        after: async (account) => {
          if (!account.userId || !account.providerId || !account.accountId)
            return;
          await hooks().afterAccountCreate({
            account: {
              userId: account.userId as string,
              providerId: account.providerId as string,
              accountId: account.accountId as string,
            },
          });
        },
      },
      update: {
        after: async (account) => {
          // BetterAuth refreshes tokens on the linked Account row on every
          // OAuth sign-in. Use that as the trigger to reconcile pendingSsoSetup
          // for users whose correct-provider account is already linked.
          if (!account.userId || !account.providerId || !account.accountId)
            return;
          await hooks().afterAccountUpdate({
            account: {
              userId: account.userId as string,
              providerId: account.providerId as string,
              accountId: account.accountId as string,
            },
          });
        },
      },
      delete: {
        /** ADR-101 §2: an account row removed is an identifier detach — and
         *  the adapter's own, for anyone it routes to the identity branch. */
        before: async (account) => {
          await accountCeremonies().beforeAccountDelete(account);
        },
      },
    },
    session: {
      create: {
        /**
         * Two jobs in one hook, in this order and no other: the refusal
         * first, then the claims (D06). A deactivated user's session must
         * not be described before it is refused, and a refusal returns
         * `false` before any read about what was proved happens.
         *
         * `context.path` is the endpoint minting the session, which is what
         * says what the sign-in proved — a password, a two-step challenge
         * answered, a passkey, a federated callback.
         */
        before: async (session, context) => {
          const refusal = await hooks().beforeSessionCreate({
            session: { userId: session.userId },
          });
          if (refusal === false) return false;
          return sessionClaimsData({
            userId: session.userId,
            path: (context as { path?: string } | undefined)?.path,
            claims: sessionClaims(),
          });
        },
        after: async (session) => {
          await hooks().afterSessionCreate({
            userId: session.userId,
          });
        },
      },
    },
  };
}
