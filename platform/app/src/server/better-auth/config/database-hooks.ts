import type { BetterAuthOptions } from "better-auth";
import { z } from "zod";
import type { BetterAuthDatabaseHooks } from "../hooks";
import type { SessionClaimsPort } from "../session-claims-hook";
import { sessionClaimsData } from "../session-claims-hook";

const hookContextSchema = z.object({ path: z.string().optional() });

function hookPath(context: unknown): string | null {
  const parsed = hookContextSchema.safeParse(context);
  return parsed.success ? (parsed.data.path ?? null) : null;
}

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
  idToken?: unknown;
}

export interface VerifiedProviderAssertionsPort {
  recordVerifiedCallbackToken(args: {
    providerId: string;
    path: string | undefined;
    verifiedIdToken: string | undefined;
  }): void;
  recordAuthenticatedCallbackAccount(args: {
    providerId: string;
    providerAccountId: string;
    path: string | undefined;
  }): void;
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
  /** The verified current callback token whose claims the session may carry. */
  providerAssertions: () => VerifiedProviderAssertionsPort;
}

type ConfiguredDatabaseHooks = NonNullable<BetterAuthOptions["databaseHooks"]>;
type AccountDatabaseHookSet = NonNullable<ConfiguredDatabaseHooks["account"]>;

function userDatabaseHooks({
  hooks,
  userErasure,
}: DatabaseHooksDeps): NonNullable<ConfiguredDatabaseHooks["user"]> {
  return {
    create: {
      before: async (user, context) => {
        const refusal = await hooks().beforeUserCreate({
          user: user as {
            email: string;
            deactivatedAt?: Date | null;
          } & Record<string, unknown>,
        });
        if (refusal === false) return false;

        if (hookPath(context) !== "/sign-up/email") return;
        return { data: { ...user, signupConfirmationPending: true } };
      },
      after: async (user) => {
        await hooks().afterUserCreate({
          user: user as { id: string; email: string; name: string },
        });
      },
    },
    delete: {
      before: async (user) => {
        await userErasure().beforeUserDelete(user);
      },
    },
  };
}

function accountCreateHooks({
  hooks,
  accountCeremonies,
  providerAssertions,
}: DatabaseHooksDeps): NonNullable<AccountDatabaseHookSet["create"]> {
  return {
    before: async (account, context) => {
      await hooks().beforeAccountCreate({
        account: {
          userId: account.userId,
          providerId: account.providerId,
          accountId: account.accountId,
        },
      });
      providerAssertions().recordVerifiedCallbackToken({
        providerId: account.providerId,
        path: hookPath(context) ?? void 0,
        verifiedIdToken:
          typeof account.idToken === "string" ? account.idToken : undefined,
      });
      return accountCeremonies().beforeAccountCreate(account);
    },
    after: async (account, context) => {
      providerAssertions().recordAuthenticatedCallbackAccount({
        providerId: account.providerId,
        providerAccountId: account.accountId,
        path: hookPath(context) ?? void 0,
      });
      if (!account.userId || !account.providerId || !account.accountId) return;

      await hooks().afterAccountCreate({
        account: {
          userId: account.userId as string,
          providerId: account.providerId as string,
          accountId: account.accountId as string,
        },
      });
    },
  };
}

function accountUpdateHooks({
  hooks,
  providerAssertions,
}: DatabaseHooksDeps): NonNullable<AccountDatabaseHookSet["update"]> {
  return {
    before: async (account, context) => {
      if (typeof account.providerId !== "string") return;

      providerAssertions().recordVerifiedCallbackToken({
        providerId: account.providerId,
        path: hookPath(context) ?? void 0,
        verifiedIdToken:
          typeof account.idToken === "string" ? account.idToken : undefined,
      });
    },
    after: async (account, context) => {
      if (
        typeof account.providerId === "string" &&
        typeof account.accountId === "string"
      ) {
        providerAssertions().recordAuthenticatedCallbackAccount({
          providerId: account.providerId,
          providerAccountId: account.accountId,
          path: hookPath(context) ?? void 0,
        });
      }
      if (!account.userId || !account.providerId || !account.accountId) return;

      await hooks().afterAccountUpdate({
        account: {
          userId: account.userId as string,
          providerId: account.providerId as string,
          accountId: account.accountId as string,
        },
      });
    },
  };
}

function accountDatabaseHooks(deps: DatabaseHooksDeps): AccountDatabaseHookSet {
  return {
    create: accountCreateHooks(deps),
    update: accountUpdateHooks(deps),
    delete: {
      before: async (account) => {
        await deps.accountCeremonies().beforeAccountDelete(account);
      },
    },
  };
}

function sessionDatabaseHooks({
  hooks,
  sessionClaims,
}: DatabaseHooksDeps): NonNullable<ConfiguredDatabaseHooks["session"]> {
  return {
    create: {
      before: async (session, context) => {
        const refusal = await hooks().beforeSessionCreate({
          session: { userId: session.userId },
        });
        if (refusal === false) return false;

        return sessionClaimsData({
          userId: session.userId,
          path: hookPath(context) ?? void 0,
          claims: sessionClaims(),
        });
      },
      after: async (session) => {
        await hooks().afterSessionCreate({ userId: session.userId });
      },
    },
  };
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
  providerAssertions,
}: DatabaseHooksDeps): BetterAuthOptions["databaseHooks"] {
  const deps = {
    hooks,
    userErasure,
    accountCeremonies,
    sessionClaims,
    providerAssertions,
  };
  return {
    user: userDatabaseHooks(deps),
    account: accountDatabaseHooks(deps),
    session: sessionDatabaseHooks(deps),
  };
}
