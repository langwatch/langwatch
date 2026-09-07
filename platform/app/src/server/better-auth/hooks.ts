import { extractEmailDomain, isSsoProviderMatch } from "@ee/sso/matching";
import { createLogger } from "@langwatch/observability";
import { APIError } from "better-auth/api";

const logger = createLogger("langwatch:better-auth:hooks");

/** One `User` row, as the hooks read it about somebody they hold an id for. */
export interface DatabaseHookUser {
  id: string;
  email: string | null;
  name: string | null;
  deactivatedAt: Date | null;
  pendingSsoSetup: boolean;
  signupConfirmationPending: boolean;
}

export interface DatabaseHookUsersPort {
  findById(args: { userId: string }): Promise<DatabaseHookUser | null>;
  updatePendingSsoSetup(args: {
    userId: string;
    pendingSsoSetup: boolean;
  }): Promise<void>;
  updateLastLoginAt(args: { userId: string; lastLoginAt: Date }): Promise<void>;
  countOrganizationMemberships(args: { userId: string }): Promise<number>;
}

export interface DatabaseHookOrganizationsPort {
  /** The organization that claims this domain through the legacy `ssoDomain`
   *  column, with the provider it names. */
  findByDomain(args: {
    domain: string;
  }): Promise<{ id: string; name: string; ssoProvider: string | null } | null>;
}

export interface DatabaseHookAccountsPort {
  countForUser(args: { userId: string }): Promise<number>;
  /** Clears `pendingSsoSetup` while preserving identities outside the exact
   * authenticated set; only a scoped retirement ceremony may delete them. */
  reconcileOAuthAccounts(args: {
    userId: string;
    keepAccounts: readonly {
      providerId: string;
      accountId: string;
    }[];
  }): Promise<void>;
}

export type SsoMigrationAccountLinkDecision =
  | { kind: "not_migrating" }
  | {
      /** A standalone grandfathered connection with canonical domain proof. */
      kind: "allow_connection";
      arrivalConnectionId: string;
      keepAccounts: readonly [{ providerId: string; accountId: string }];
    }
  | {
      kind: "allow_replacement_pair";
      /** The exact connection this callback arrived through. */
      arrivalConnectionId: string;
      /**
       * The exact predecessor and replacement accounts. The policy may issue
       * this decision only after the incoming assertion and the local email
       * are both verified, exactly one local user matches, and both
       * connections belong to that user's organization.
       */
      keepAccounts: readonly [
        { providerId: string; accountId: string },
        { providerId: string; accountId: string },
      ];
    }
  | {
      kind: "reject";
      code:
        | "SSO_MIGRATION_LINK_UNVERIFIED"
        | "SSO_MIGRATION_LINK_AMBIGUOUS"
        | "SSO_MIGRATION_LINK_NOT_ALLOWED"
        | "SSO_LEGACY_AUTH_RETIRED";
    };

/**
 * The migration-specific decision made from the persisted predecessor /
 * replacement relationship and callback evidence. Keeping this behind one
 * port prevents the Better Auth boundary from guessing that every Auth0 or
 * connection-shaped provider belongs to the same tenant.
 */
export interface DatabaseHookSsoMigrationPort {
  decideAccountLink(args: {
    userId: string;
    providerId: string;
    accountId: string;
  }): Promise<SsoMigrationAccountLinkDecision>;

  /**
   * Atomically refuses a retired legacy callback or records a successful
   * callback authentication. The implementation keys the callback path to a
   * connection and writes dedicated authentication activity; it must never
   * substitute `Identifier.lastUsedAt`, which records resolution rather than
   * successful authentication.
   */
  authorizeAndRecordAuthentication(args: {
    userId: string;
    path: string | undefined;
    authenticatedAt: Date;
  }): Promise<
    | { action: "continue" }
    | {
        action: "reject";
        code:
          | "SSO_LEGACY_AUTH_RETIRED"
          | "SSO_MIGRATION_AUTH_AMBIGUOUS"
          | "SSO_MIGRATION_AUTH_NOT_ALLOWED";
      }
  >;
}

export interface DatabaseHookAnalyticsPort {
  /** The `signed_up` milestone, under the same distinct id posthog-js
   *  identifies with client-side, so the two join one person. */
  trackSignUp(args: { userId: string }): void;
}

export interface DatabaseHookNurturingPort {
  trackActivity(args: { userId: string; hasOrganization: boolean }): void;
  syncProfile(args: { userId: string; hasOrganization: boolean }): void;
}

/**
 * `SsoArrivalService`'s two verbs, named here rather than imported.
 *
 * ADR-115's boundary test says better-auth reaches app-layer identity through
 * `runtime.ts` and nothing else, and it counts a type import as a reach — so
 * the shape the hooks depend on is stated where they depend on it, and the
 * service satisfies it by being that shape.
 */
export interface DatabaseHookSsoArrivalPort {
  /** What happens to somebody a connection has never seen (ADR-117 §3). */
  admit(args: {
    user: { id: string; email: string; name: string };
    connectionId: string;
    domain: string;
  }): Promise<void>;
}

export interface BetterAuthDatabaseHooksDeps {
  users: DatabaseHookUsersPort;
  organizations: DatabaseHookOrganizationsPort;
  accounts: DatabaseHookAccountsPort;
  ssoArrival: DatabaseHookSsoArrivalPort;
  ssoMigration: DatabaseHookSsoMigrationPort;
  /**
   * ADR-027 (Decision 7): domain auto-join and `ssoDomain` enforcement are
   * federation, and federation rides the platform SSO gate. A closure rather
   * than the gate module, so a hook can be driven without one.
   */
  federationAllowed: () => Promise<boolean>;
  analytics: DatabaseHookAnalyticsPort;
  nurturing: DatabaseHookNurturingPort;
}

/**
 * better-auth's `databaseHooks`, as one class over the identity services
 * (ADR-129).
 *
 * Each method is one of the framework's slots. What a slot decides about the
 * data it is handed belongs to a service; what is left here is the
 * translation — better-auth's loosely typed row into the arguments a service
 * takes, and a service's answer back into the `false` / `{ data }` / thrown
 * `APIError` shapes better-auth understands. The `APIError` codes are part of
 * that contract: better-auth preserves them in the OAuth callback redirect,
 * and `/auth/error` renders each one.
 */
export class BetterAuthDatabaseHooks {
  constructor(private readonly deps: BetterAuthDatabaseHooksDeps) {}

  /**
   * Before a new user is created — by OAuth signup, by a federated callback,
   * or by email+password signup.
   *
   * Blocks deactivated users. We only get here for BRAND new users, so
   * `deactivatedAt` should always be null — but we check defensively in case
   * of a pre-seeded deactivated row.
   *
   * A NAMELESS ACCOUNT GETS ITS ADDRESS AS ITS NAME. Every screen that names
   * somebody reads `User.name`, and the ways in that do not ask for one are the
   * ordinary ones now: a passkey sign-up has no name field at all, an identity
   * provider may assert none, and an OAuth profile can carry `null`. The header
   * menu rendered the result as literally "null (sam@acme.com)". This is the one
   * place every creation path passes through, so filling it here is what stops
   * each of those paths needing to remember.
   */
  beforeUserCreate({
    user,
  }: {
    user: { email: string; deactivatedAt?: Date | null } & Record<
      string,
      unknown
    >;
  }): boolean | undefined | { data: Record<string, unknown> } {
    if (user.deactivatedAt) {
      logger.warn({ email: user.email }, "Blocked signup: user is deactivated");
      return false;
    }

    // Whitespace counts as empty: a name that renders as an unexplained gap is
    // the same bug as one that renders as "null".
    const name = typeof user.name === "string" ? user.name.trim() : "";
    if (!name) return { data: { ...user, name: user.email } };

    // Otherwise a no-op: org auto-assignment happens in the after-create hook so
    // that we have a real user id to link with.
    return undefined;
  }

  /**
   * After a new user is created, record the signup milestone. Organization
   * arrival happens only after an authenticated provider account callback,
   * where a canonical proved connection and its arrival policy are known.
   * A bare legacy `ssoDomain` is login compatibility, never ownership proof.
   */
  afterUserCreate({
    user,
  }: {
    user: { id: string; email: string; name: string };
  }): void {
    this.deps.analytics.trackSignUp({ userId: user.id });
  }

  /**
   * Before a new Account row is created. Ports the provider-linking and
   * `pendingSsoSetup` logic from the NextAuth signIn callback:
   *
   * - new user + SSO org + wrong OAuth provider → HARD BLOCK
   *   (SSO_PROVIDER_NOT_ALLOWED). New signups at an SSO-enforced domain must
   *   use the configured provider. "New" = this is the user's first account.
   *   Credential accounts are exempt because credentials signup only runs in
   *   on-prem / email-mode deployments where SSO isn't configured.
   * - existing user + SSO org + correct provider → let it through;
   *   reconciliation is deferred to `afterAccountCreate` so the cleanup only
   *   commits once the new Account row exists.
   * - existing user + SSO org + wrong provider → set `pendingSsoSetup=true`
   *   and DO NOT hard-block, so existing users are not locked out during a
   *   migration; the banner in DashboardLayout is what tells them.
   * - no SSO org → normal account creation.
   */
  async beforeAccountCreate({
    account,
  }: {
    account: { userId: string; providerId: string; accountId: string };
  }): Promise<void> {
    const user = await this.deps.users.findById({ userId: account.userId });
    if (!user?.email) return;

    this.throwIfDeactivated(user);

    // ADR-027: when the platform SSO gate denies, all ssoDomain enforcement is
    // off (site #4, mirroring `afterUserCreate`). Critically, this stops the
    // `pendingSsoSetup=true` soft-flag below from being written when the v6
    // reset-recovery path creates a `credential` account for an OAuth-born user
    // on an unlicensed install — that flag would otherwise strand them behind a
    // permanent "Link your SSO account" banner they can never clear (every SSO
    // path 403s on a denied deployment).
    if (!(await this.deps.federationAllowed())) {
      // warn for the same reason the `afterUserCreate` site does: an operator
      // grepping warn for "why is federation not happening" has to find both
      // halves of the answer, not one.
      logger.warn(
        { userId: user.id, providerId: account.providerId },
        "Skipped ssoDomain enforcement: platform SSO gate denies (no genuine license)",
      );
      return;
    }

    if (await this.beforeMigrationAccountLink(account)) return;

    const domain = extractEmailDomain(user.email);
    if (!domain) return;

    const org = await this.deps.organizations.findByDomain({ domain });
    if (!org) return;

    if (isSsoProviderMatch(org, account)) return;

    // Wrong provider for this SSO org. Determine whether this is a first-time
    // signup (hard block) or an existing user trying a different provider
    // (soft block via pendingSsoSetup banner).
    if (account.providerId !== "credential" && org.ssoProvider) {
      const existingAccountCount = await this.deps.accounts.countForUser({
        userId: user.id,
      });
      if (existingAccountCount === 0) {
        logger.warn(
          {
            userId: user.id,
            attemptedProvider: account.providerId,
            orgSsoProvider: org.ssoProvider,
          },
          "Blocked new signup: provider does not match SSO-enforced org",
        );
        throw APIError.from("FORBIDDEN", {
          code: "SSO_PROVIDER_NOT_ALLOWED",
          message: "SSO_PROVIDER_NOT_ALLOWED",
        });
      }
    }

    await this.deps.users.updatePendingSsoSetup({
      userId: user.id,
      pendingSsoSetup: true,
    });
    logger.info(
      {
        userId: user.id,
        attemptedProvider: account.providerId,
        orgSsoProvider: org.ssoProvider,
      },
      "Flagged existing user with pendingSsoSetup (wrong SSO provider)",
    );
  }

  /**
   * After a new Account row is created: the connection's own arrival door,
   * then the legacy `ssoDomain` reconciliation.
   *
   * The two are asked independently and in that order. They answer for
   * different populations — a self-serve connection never writes `ssoDomain` —
   * so an arrival that reaches this line has to be decided by the first or not
   * at all.
   *
   * Credential accounts skip this entirely: on-prem email-mode deployments
   * configure no SSO.
   */
  async afterAccountCreate({
    account,
  }: {
    account: { userId: string; providerId: string; accountId: string };
  }): Promise<void> {
    try {
      if (account.providerId === "credential") return;

      const user = await this.deps.users.findById({ userId: account.userId });
      if (!user?.email) return;

      const domain = extractEmailDomain(user.email);
      if (!domain) return;

      const migration = await this.deps.ssoMigration.decideAccountLink(account);
      if (migration.kind === "reject") return;

      await this.deps.ssoArrival.admit({
        user: { id: user.id, email: user.email, name: user.name ?? "" },
        connectionId:
          migration.kind === "allow_replacement_pair" ||
          migration.kind === "allow_connection"
            ? migration.arrivalConnectionId
            : account.providerId,
        domain,
      });

      if (
        migration.kind === "allow_replacement_pair" ||
        migration.kind === "allow_connection"
      ) {
        await this.deps.accounts.reconcileOAuthAccounts({
          userId: user.id,
          keepAccounts: migration.keepAccounts,
        });
        return;
      }
      await this.reconcileToConfiguredProvider({ user, account, domain });
    } catch (err) {
      logger.error(
        { err, userId: account.userId },
        "Failed to reconcile SSO accounts after account create",
      );
    }
  }

  /**
   * After an existing Account row is updated. On an OAuth sign-in via
   * `handleOAuthUserInfo`, BetterAuth refreshes tokens on the linked Account
   * row, which fires this hook.
   *
   * Closes the dual-account edge case for `pendingSsoSetup`: somebody who
   * previously signed in with the WRONG provider carries the flag and a stale
   * Account row; when they later sign in with the CORRECT one and that
   * Account already exists, no new Account is created, `beforeAccountCreate`
   * never fires, and the flag stays stuck. This hook runs on every token
   * refresh, so it is where that is cleaned up.
   */
  async afterAccountUpdate({
    account,
  }: {
    account: { userId: string; providerId: string; accountId: string };
  }): Promise<void> {
    try {
      const user = await this.deps.users.findById({ userId: account.userId });
      if (!user?.email) return;

      const domain = extractEmailDomain(user.email);
      if (!domain) return;

      // ASKED ON EVERY SIGN-IN, not only the first.
      //
      // The arrival decision refuses a connection that is not yet ACTIVE, and
      // this hook is the only one that runs on a RETURNING sign-in — the
      // account row already exists, so `account.create.after` never fires
      // again. Deciding arrivals only there meant everybody who signed in
      // during setup was decided once, while the answer was still "not live",
      // and never again: an account, no membership, no request, and an empty
      // queue on the administrator's screen. That includes the administrator
      // who performed the test sign-in activation refuses to go without.
      //
      // Idempotent, so asking every time costs a read: it returns early on an
      // existing membership, and the join guard refuses a duplicate request.
      const migration = await this.deps.ssoMigration.decideAccountLink(account);
      if (migration.kind === "reject") return;

      await this.deps.ssoArrival.admit({
        user: { id: user.id, email: user.email, name: user.name ?? "" },
        connectionId:
          migration.kind === "allow_replacement_pair" ||
          migration.kind === "allow_connection"
            ? migration.arrivalConnectionId
            : account.providerId,
        domain,
      });

      if (
        migration.kind === "allow_replacement_pair" ||
        migration.kind === "allow_connection"
      ) {
        await this.deps.accounts.reconcileOAuthAccounts({
          userId: user.id,
          keepAccounts: migration.keepAccounts,
        });
        return;
      }
      if (!user.pendingSsoSetup) return;

      const reconciled = await this.reconcileToConfiguredProvider({
        user,
        account,
        domain,
      });
      if (!reconciled) return;

      logger.info(
        { userId: user.id, providerId: account.providerId },
        "Cleared pendingSsoSetup after sign-in via the configured SSO provider",
      );
    } catch (err) {
      logger.error(
        { err, userId: account.userId },
        "Failed to reconcile pendingSsoSetup after account update",
      );
    }
  }

  /**
   * Before a Session is created. Blocks deactivated users at this last layer.
   */
  async beforeSessionCreate({
    session,
    path,
  }: {
    session: { userId: string };
    path?: string;
  }): Promise<boolean | undefined> {
    const user = await this.deps.users.findById({ userId: session.userId });
    if (user?.deactivatedAt) {
      logger.warn(
        { userId: session.userId },
        "Blocked session create: user deactivated",
      );
      return false;
    }
    if (user?.signupConfirmationPending) {
      logger.warn(
        { userId: session.userId },
        "Blocked session create: sign-up confirmation pending",
      );
      return false;
    }

    const migration =
      await this.deps.ssoMigration.authorizeAndRecordAuthentication({
        userId: session.userId,
        path,
        authenticatedAt: new Date(),
      });
    if (migration.action === "reject") {
      throw APIError.from("FORBIDDEN", {
        code: migration.code,
        message: migration.code,
      });
    }
    return undefined;
  }

  /**
   * After a Session is created. Updates `User.lastLoginAt` and fires the
   * fire-and-forget nurturing hooks. The `lastLoginAt` update is awaited so
   * the invariant holds immediately for subsequent requests on the same
   * session.
   *
   * Skipped entirely when the session is an admin-impersonation session — we
   * don't want an admin's activity to ghost-write the target user's
   * `lastLoginAt`. In practice no impersonation reaches here at all: starting
   * one writes the `{actor, subject}` claims onto the operator's EXISTING
   * session rather than minting a new one (D06), so this hook only ever sees
   * real sign-ins. The parameter survives for callers that mint a session on
   * somebody's behalf.
   */
  async afterSessionCreate({
    userId,
    isImpersonationSession = false,
  }: {
    userId: string;
    isImpersonationSession?: boolean;
  }): Promise<void> {
    if (!isImpersonationSession) {
      try {
        await this.deps.users.updateLastLoginAt({
          userId,
          lastLoginAt: new Date(),
        });
      } catch (err) {
        logger.error(
          { err, userId },
          "Failed to update lastLoginAt after session create",
        );
      }
    }

    // Fire-and-forget, and it must never block the response.
    void this.deps.users
      .countOrganizationMemberships({ userId })
      .then((memberships) => {
        const hasOrganization = memberships > 0;
        this.deps.nurturing.trackActivity({ userId, hasOrganization });
        this.deps.nurturing.syncProfile({ userId, hasOrganization });
      })
      .catch((err) => {
        logger.error(
          { err, userId },
          "Failed to fire nurturing hooks after session create",
        );
      });
  }

  /**
   * The stale-row cleanup both account hooks run, when — and only when — the
   * account that just landed IS the one the organization's legacy `ssoDomain`
   * configuration names. Answers whether it ran.
   */
  private async reconcileToConfiguredProvider({
    user,
    account,
    domain,
  }: {
    user: DatabaseHookUser;
    account: { providerId: string; accountId: string };
    domain: string;
  }): Promise<boolean> {
    const org = await this.deps.organizations.findByDomain({ domain });
    if (!org) return false;
    if (!isSsoProviderMatch(org, account)) return false;

    await this.deps.accounts.reconcileOAuthAccounts({
      userId: user.id,
      keepAccounts: [
        { providerId: account.providerId, accountId: account.accountId },
      ],
    });
    return true;
  }

  /** Answers whether an explicitly proved predecessor/replacement pair owns
   * this callback. Every other account continues through the legacy rule. */
  private async beforeMigrationAccountLink(account: {
    userId: string;
    providerId: string;
    accountId: string;
  }): Promise<boolean> {
    if (account.providerId === "credential") return false;

    const migration = await this.deps.ssoMigration.decideAccountLink(account);
    if (migration.kind === "reject") {
      throw APIError.from("FORBIDDEN", {
        code: migration.code,
        message: migration.code,
      });
    }
    return (
      migration.kind === "allow_replacement_pair" ||
      migration.kind === "allow_connection"
    );
  }

  private throwIfDeactivated(user: DatabaseHookUser): void {
    if (!user.deactivatedAt) return;

    // The session hook also blocks this, but failing fast avoids leaving a
    // stray Account row behind.
    throw APIError.from("FORBIDDEN", {
      code: "USER_DEACTIVATED",
      message: "USER_DEACTIVATED",
    });
  }
}
