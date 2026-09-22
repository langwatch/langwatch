import {
  extractEmailDomain,
  isSsoProviderMatch,
  matchesConfiguredSsoProvider,
} from "@ee/sso/matching";
import { isNativeSocialProvider } from "@ee/sso/providers";
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

/**
 * ADR-117 §3's evidence rule, as `beforeAccountCreate` asks it.
 *
 * A provider that asserted nothing — no ID token, or no `email_verified`
 * beside the address — refuses nothing; the answer is a refusal reason or
 * `null`, and a refusal has already recorded the proposal an administrator
 * acts on.
 */
export interface DatabaseHookSignInEvidencePort {
  refusalForLink(input: {
    userId: string;
    providerId: string;
    providerAccountId: string;
    idToken: string | undefined;
  }): Promise<string | null>;
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

/**
 * Whether an ORGANIZATION'S OWN connection governs an address, and which one.
 *
 * The legacy `ssoDomain` columns are `DatabaseHookOrganizationsPort`'s
 * question and a different population's answer: a self-serve connection never
 * writes them, so every organization that registered its own provider — the
 * whole point of that journey — is invisible to `findByDomain`.
 *
 * Answered by the sign-in router rather than re-derived here, which is what
 * makes live, proved and lapsed mean the same thing on this path as on the
 * front door. ADR-123's rule rides along for free: a lapsed domain still
 * ROUTES, so somebody who already works there is still sent to the provider,
 * and the arrival door is the one that then admits nobody new.
 *
 * It answers the connection rather than a boolean because the refusal is a
 * BOUNCE — the connection is what made the refusal, and carrying it is the
 * difference between sending somebody to their own provider and showing them
 * a page about why they cannot have Google.
 */
export interface DatabaseHookConnectionRoutingPort {
  connectionGoverning(args: {
    email: string;
  }): Promise<{ connectionId: string } | null>;
}

export interface BetterAuthDatabaseHooksDeps {
  users: DatabaseHookUsersPort;
  organizations: DatabaseHookOrganizationsPort;
  /** D04: the organization's own connection, ahead of the legacy columns. */
  connectionRouting: DatabaseHookConnectionRoutingPort;
  accounts: DatabaseHookAccountsPort;
  ssoArrival: DatabaseHookSsoArrivalPort;
  ssoMigration: DatabaseHookSsoMigrationPort;
  /**
   * ADR-027 (Decision 7): domain auto-join and `ssoDomain` enforcement are
   * federation, and federation rides the platform SSO gate. A closure rather
   * than the gate module, so a hook can be driven without one.
   */
  federationAllowed: () => Promise<boolean>;
  /** ADR-117 §3. Optional so a hook can be driven without the rule. */
  signInEvidence?: DatabaseHookSignInEvidencePort;
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
   *   flag clearing is deferred to `afterAccountCreate` so it only commits
   *   once the new Account row exists.
   * - any user + SSO org + a NATIVE social provider → HARD BLOCK. These
   *   buttons (Google, GitHub, Microsoft) mount beside the broker rather than
   *   through it, so no existing member's way in runs through one and refusing
   *   locks nobody out. Admitting one would give an organization that enforces
   *   single sign-on a second door, outside the identity provider it
   *   deprovisions in.
   * - existing user + SSO org + wrong BROKERED provider → set
   *   `pendingSsoSetup=true` and DO NOT hard-block, so existing users are not
   *   locked out during a migration; the banner in DashboardLayout is what
   *   tells them.
   * - no SSO org → normal account creation.
   */
  async beforeAccountCreate({
    account,
  }: {
    account: {
      userId: string;
      providerId: string;
      accountId: string;
      /** The callback's own ID token, for the rule that weighs its claims. */
      idToken?: string;
    };
  }): Promise<void> {
    const user = await this.deps.users.findById({ userId: account.userId });
    if (!user?.email) return;

    this.throwIfDeactivated(user);

    await this.refuseLinkOnInsufficientEvidence(account);

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

    // The organization's own connection, ahead of the legacy columns: it is
    // the answer for every organization that registered one, and the legacy
    // block below is the answer for every organization that never did.
    await this.bounceNativeProviderToConnection({
      email: user.email,
      account,
    });

    const domain = extractEmailDomain(user.email);
    if (!domain) return;

    const org = await this.deps.organizations.findByDomain({ domain });
    if (!org) return;

    if (isSsoProviderMatch(org, account)) return;

    // Wrong provider for this SSO org.
    if (account.providerId !== "credential" && org.ssoProvider) {
      const { shouldRefuse, rule } = await this.wrongProviderVerdict({
        userId: user.id,
        providerId: account.providerId,
      });

      if (shouldRefuse) {
        logger.warn(
          {
            userId: user.id,
            attemptedProvider: account.providerId,
            orgSsoProvider: org.ssoProvider,
            rule,
          },
          "Refused sign-in: provider does not match SSO-enforced org",
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
   * The bounce: a native social button pressed by somebody whose organization
   * signs its people in through its own connection.
   *
   * WHY IT IS NOT THE LEGACY GUARD BELOW. That one asks `findByDomain`, which
   * reads `Organization.ssoDomain` — two staff-set strings a self-serve
   * connection never writes. An organization that proved its domain and went
   * live through the setup journey therefore matched nothing there, and the
   * button that skips the router skipped every rule the router enforces: the
   * Google identity was attached, no membership was created, no request was
   * queued, and the arrival policy the organization chose never ran.
   *
   * WHY IT THROWS RATHER THAN ROUTING. Nothing on the social path carries an
   * address until the callback, by which point better-auth is already writing
   * the account. Refusing here is the last moment before that, and better-auth
   * carries an `APIError`'s code AND message into the callback redirect — so
   * the connection travels with the refusal and `/auth/error` dials it. The
   * person sees their own identity provider, not an error page.
   *
   * NATIVE PROVIDERS ONLY, exactly as the legacy guard: the connection dialling
   * itself arrives under its own id, and a brokered sign-in mid-migration is
   * the population `pendingSsoSetup` exists for. Refusing either would turn
   * somebody away from the door they are supposed to be walking through.
   */
  private async bounceNativeProviderToConnection({
    email,
    account,
  }: {
    email: string;
    account: { userId: string; providerId: string };
  }): Promise<void> {
    if (!isNativeSocialProvider(account.providerId)) return;

    const governing = await this.deps.connectionRouting.connectionGoverning({
      email,
    });
    if (!governing) return;

    logger.info(
      {
        userId: account.userId,
        attemptedProvider: account.providerId,
        connectionId: governing.connectionId,
      },
      "Sent a native social sign-in to the organization's own connection",
    );
    // The message is the bounce TARGET, not prose: better-auth puts it in
    // `error_description` on the callback redirect, and the error route reads
    // it as a connection identifier — never as an address to navigate to.
    throw APIError.from("FORBIDDEN", {
      code: "SSO_REQUIRED_BY_ORGANIZATION",
      message: governing.connectionId,
    });
  }

  /**
   * Whether a provider that does not match the organization's is refused
   * outright, or only soft-flagged — and which rule decided, for the log line
   * an operator reads when somebody reports being turned away.
   *
   * The account count is asked only where it can change the answer: a native
   * provider is refused whoever is pressing it, so the query is one this path
   * stops making rather than makes and ignores.
   */
  private async wrongProviderVerdict({
    userId,
    providerId,
  }: {
    userId: string;
    providerId: string;
  }): Promise<{ shouldRefuse: boolean; rule: string }> {
    if (isNativeSocialProvider(providerId)) {
      return { shouldRefuse: true, rule: "native_social_provider" };
    }
    const existingAccountCount = await this.deps.accounts.countForUser({
      userId,
    });
    return { shouldRefuse: existingAccountCount === 0, rule: "first_account" };
  }

  /**
   * The refusal `beforeAccountCreate` makes, on the path it cannot see.
   *
   * better-auth writes an `Account` row the first time a provider is linked
   * and only UPDATES it on every sign-in after (`handleOAuthUserInfo` takes
   * the `updateAccount` branch once a row matches the issuer and subject). A
   * guard that lives on the create path alone therefore closes the door to NEW
   * links while every link already made keeps letting its holder in —
   * including the ones the old soft block wrote before this rule existed.
   *
   * Native providers only, exactly as on the create path: a brokered sign-in
   * on the wrong connection is the mid-migration member the soft flag is for.
   *
   * BOTH refusals live here, in the order they live in on the create path —
   * the organization's own connection first, which bounces, and the legacy
   * columns after, which do not. An account linked before the connection
   * existed is exactly the population that reaches this seam and never the
   * other one.
   */
  private async refuseNativeProviderOnSignIn(account: {
    userId: string;
    providerId: string;
    accountId: string;
  }): Promise<void> {
    if (!isNativeSocialProvider(account.providerId)) return;
    if (!(await this.deps.federationAllowed())) return;

    const user = await this.deps.users.findById({ userId: account.userId });
    const domain = extractEmailDomain(user?.email);
    if (!domain) return;

    if (user?.email) {
      await this.bounceNativeProviderToConnection({
        email: user.email,
        account,
      });
    }

    const org = await this.deps.organizations.findByDomain({ domain });
    // A `ssoProvider` the account already matches is this organization's own
    // door — an organization pinned to `google` signs in with Google, and
    // `isSsoProviderMatch` is what says so.
    if (!org?.ssoProvider || isSsoProviderMatch(org, account)) return;

    logger.warn(
      {
        userId: account.userId,
        attemptedProvider: account.providerId,
        orgSsoProvider: org.ssoProvider,
        rule: "native_social_provider",
        path: "account_update",
      },
      "Refused sign-in: provider does not match SSO-enforced org",
    );
    throw APIError.from("FORBIDDEN", {
      code: "SSO_PROVIDER_NOT_ALLOWED",
      message: "SSO_PROVIDER_NOT_ALLOWED",
    });
  }

  /**
   * ADR-117 §3, asked before the `ssoDomain` rules because it is not one of
   * them. Silent on every path that did not carry the evidence to judge.
   */
  private async refuseLinkOnInsufficientEvidence(account: {
    userId: string;
    providerId: string;
    accountId: string;
    idToken?: string;
  }): Promise<void> {
    const refusal = await this.deps.signInEvidence?.refusalForLink({
      userId: account.userId,
      providerId: account.providerId,
      providerAccountId: account.accountId,
      idToken: account.idToken,
    });
    if (!refusal) return;

    logger.warn(
      {
        userId: account.userId,
        providerId: account.providerId,
        reason: refusal,
      },
      "Refused a sign-in link on insufficient evidence; a proposal was recorded for an administrator",
    );
    // APIError so better-auth carries the code into the callback redirect,
    // where /auth/error renders the copy registered for it.
    throw APIError.from("FORBIDDEN", {
      code: "LINK_NEEDS_APPROVAL",
      message: "LINK_NEEDS_APPROVAL",
    });
  }

  /**
   * After a new Account row is created: the connection's own arrival door,
   * then the legacy `ssoDomain` provider flag handling.
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
        await this.deps.users.updatePendingSsoSetup({
          userId: user.id,
          pendingSsoSetup: false,
        });
        return;
      }
      await this.clearPendingSsoSetupForConfiguredProvider({
        user,
        account,
        domain,
      });
    } catch (err) {
      logger.error(
        { err, userId: account.userId },
        "Failed to process SSO account after account create",
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
    // Outside the try below, deliberately: this one REFUSES, and a refusal the
    // processing's catch swallowed would admit the very sign-in it exists
    // to stop.
    await this.refuseNativeProviderOnSignIn(account);

    try {
      const user = await this.deps.users.findById({ userId: account.userId });
      const email = user?.email;
      if (!user || !email) return;

      const domain = extractEmailDomain(email);
      if (!domain) return;

      await this.admitAndClearPendingSsoSetup({
        user: { ...user, email },
        account,
        domain,
      });
    } catch (err) {
      logger.error(
        { err, userId: account.userId },
        "Failed to process pendingSsoSetup after account update",
      );
    }
  }

  /**
   * Admit the arrival, then settle whichever flag update it calls for.
   *
   * Split out of {@link afterAccountUpdate} so the hook itself is the two
   * facts it needs and one call: this is the part with branches, and it reads
   * as the sequence it is rather than as a body nested inside a `try`.
   */
  private async admitAndClearPendingSsoSetup({
    user,
    account,
    domain,
  }: {
    user: DatabaseHookUser & { email: string };
    account: { userId: string; providerId: string; accountId: string };
    domain: string;
  }): Promise<void> {
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
      await this.deps.users.updatePendingSsoSetup({
        userId: user.id,
        pendingSsoSetup: false,
      });
      return;
    }
    if (!user.pendingSsoSetup) return;

    const cleared = await this.clearPendingSsoSetupForConfiguredProvider({
      user,
      account,
      domain,
    });
    if (!cleared) return;

    logger.info(
      { userId: user.id, providerId: account.providerId },
      "Cleared pendingSsoSetup after sign-in via the configured SSO provider",
    );
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
   * Clears the pending flag when — and only when — the account that just
   * landed IS the one the organization's legacy `ssoDomain` configuration
   * names. Answers whether it ran.
   */
  private async clearPendingSsoSetupForConfiguredProvider({
    user,
    account,
    domain,
  }: {
    user: DatabaseHookUser;
    account: { providerId: string; accountId: string };
    domain: string;
  }): Promise<boolean> {
    const matched = await matchesConfiguredSsoProvider({
      organizations: this.deps.organizations,
      domain,
      accounts: [account],
    });
    if (!matched) return false;

    await this.deps.users.updatePendingSsoSetup({
      userId: user.id,
      pendingSsoSetup: false,
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
