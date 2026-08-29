/**
 * The signed-in person's own account over the process's tRPC transport.
 *
 * Four groups of procedures, and the grouping is the authorization story:
 *
 *   the account itself   getAccountInfo, getSsoStatus, getLinkedAccounts,
 *                        unlinkAccount, updateLastLogin, isAdmin,
 *                        setLastHomePath, the trace-explorer tour and the
 *                        passkey nudge — all keyed on the session's own user
 *                        id, so no tenant scope exists to check.
 *   credentials          register, setPassword, changePassword — the same,
 *                        plus a throttle on every one of them, because a
 *                        credential outlives the session that set it.
 *   the avatar           setAvatar / removeAvatar. Setting one names an
 *                        organization (the personal workspace it is stored
 *                        under), so that one takes `organization:view`.
 *   the /me dashboard    personalContext, personalBudget,
 *                        requestBudgetIncrease, homePagePickerState —
 *                        organization-scoped reads of the caller's OWN usage,
 *                        at `organization:view`, with membership re-checked
 *                        where the answer is not already narrowed to the
 *                        caller.
 *
 * Three more of the /me dashboard's procedures — `personalUsage`,
 * `budgetOverview` and `cliBootstrap` — are mounted beside these by the
 * process rather than living here. Their answers ARE the Enterprise
 * governance contract's wire shapes, and a core feature package may not
 * import an Enterprise contract (`langwatch/package-boundaries`). Restating
 * those shapes here would fork the contract, so the process keeps them until
 * they move to the governance feature that owns them.
 *
 * Every procedure acts on the SESSION's user. The only user id in any input
 * is `deactivate`/`reactivate`'s, and those two check self-or-instance-admin
 * in the handler because the identity they authorize against is the platform
 * operator list rather than a tenant.
 *
 * Transport only: gates, throttles, and delegation to {@link UserApp} — which
 * is where the user's own service, the browser-session revocations, the
 * operator check and the personal workspace now arrive from — and to the
 * process capabilities that are not the user's own: the deployment's auth
 * provider, the Auth0 tenant, the governance and gateway rollups behind the
 * /me dashboard, and the mailer.
 *
 * Spec: packages/features/user/specs/user.feature,
 *       specs/settings/user-avatar.feature.
 */
import type { AuthzDeclaration } from "@langwatch/authz-contract";
import { passwordProblem } from "@langwatch/identity-contract";
import { createLogger } from "@langwatch/observability";
import { ValidationError } from "@langwatch/handled-error";
import {
  EmailAlreadyRegisteredError,
  userApiChangePasswordInputSchema,
  userApiEmptyInputSchema,
  userApiOrganizationInputSchema,
  userApiRegisterInputSchema,
  userApiRequestBudgetIncreaseInputSchema,
  userApiSetAvatarInputSchema,
  userApiSetLastHomePathInputSchema,
  userApiSetPasswordInputSchema,
  userApiUnlinkAccountInputSchema,
  userApiUserInputSchema,
  UserAvatarRateLimitedError,
} from "@langwatch/user-contract";
import {
  TRPCError,
  type AnyTRPCRootTypes,
  type TRPCRootObject,
  type TRPCRuntimeConfigOptions,
} from "@trpc/server";
import type { UserApp } from "#app/user.app";

const logger = createLogger("langwatch:user-router");

/**
 * How long "not now" lasts (ADR-120). Long enough that the offer reads as an
 * offer rather than a nag, short enough that somebody who declined on the day
 * they signed up is asked again once they have something worth protecting.
 */
const PASSKEY_NUDGE_INTERVAL_DAYS = 30;

/**
 * The authenticated principal, as the process's session carries it.
 *
 * `impersonator` is set when an operator is browsing as this user: the outer
 * fields are the SUBJECT's and `impersonator` is the operator's, which is why
 * every write below that would outlive a session is skipped while it is set.
 */
type UserTrpcSession = Readonly<{
  user: Readonly<{
    id: string;
    name?: string | null;
    email?: string | null;
    impersonator?: Readonly<{ id: string; email?: string | null }>;
  }>;
  /** The browser-session row id, so a credential write can keep this tab. */
  sessionId?: string;
}>;

/**
 * The process supplies authentication; authorization arrives as `policy`.
 *
 * `app` is the slice of the process's application this feature reaches, not
 * the feature's application itself, because a tRPC root is shared by every
 * feature mounted on it and so carries all of them. Before {@link UserApp}
 * this was an inline bag of four narrowed services declared here, which put
 * the composition of the feature inside one of its transports and left
 * nothing for a second door to be handed.
 */
export type UserTrpcContext = Readonly<{
  app: Readonly<{ users: UserApp }>;
  session: UserTrpcSession | null;
}>;

type UserTrpcProcedures<
  TContext extends UserTrpcContext,
  TOptions extends TRPCRuntimeConfigOptions<TContext, object>,
  TRoot extends AnyTRPCRootTypes,
> = Readonly<{
  /** The process's authenticated procedure. */
  protected: TRPCRootObject<TContext, object, TOptions, TRoot>["procedure"];
  /** The process's unauthenticated procedure — `register` predates an account. */
  public: TRPCRootObject<TContext, object, TOptions, TRoot>["procedure"];
  /**
   * The process's tracing, logging, error, scope-lineage, authorization and
   * audit policy for one access declaration.
   *
   * Applied by this feature AFTER its own input parser rather than composed
   * ahead of it, because the authorization check reads its scope id from the
   * validated input: tRPC runs middlewares in the order they were added, so a
   * check installed before `.input()` would see no input at all.
   */
  policy(declaration: AuthzDeclaration): <TProcedure>(procedure: TProcedure) => TProcedure;
}>;

/** What `changeAuth0Password` can answer, as outcomes rather than exceptions. */
export type Auth0PasswordChangeOutcome =
  | { outcome: "changed" }
  | { outcome: "wrong_password" }
  /** The Auth0 tenant's own policy refused the new password; its wording. */
  | { outcome: "weak_password"; message: string }
  | { outcome: "insufficient_scope" }
  | { outcome: "password_grant_not_enabled" }
  | { outcome: "not_configured" }
  | { outcome: "failed" };

/** What an unlink can answer. `last_account` is a refusal, not a failure. */
export type UnlinkAccountOutcome = "unlinked" | "last_account" | "not_found";

/**
 * The process capabilities this transport needs that are not the user's own.
 *
 * The /me dashboard's usage, budget and CLI-bootstrap answers are declared as
 * `unknown` on purpose: they are the governance and gateway services' own wire
 * shapes, forwarded through this transport untouched. `create` is generic over
 * the concrete ports, so the router's inferred output is the real shape and
 * nothing about the contract is lost at the client.
 */
export type UserTrpcPorts = Readonly<{
  // -- the deployment ------------------------------------------------------
  /** `"email"`, `"auth0"`, or a federated provider name (ADR-027). */
  resolveAuthProvider(): Promise<string>;
  /** Whether this deployment offers passkeys at all (ADR-120). */
  deploymentOffersPasskeys(): boolean;
  /** The instance's public base URL, for the budget-increase deep link. */
  appBaseUrl(): string | null;
  /** The caller's IP, for the per-IP signup throttle. `"unknown"` when absent. */
  clientIp(ctx: UserTrpcContext): string;
  /** The shared counter. Returns whether this attempt is inside the budget. */
  rateLimit(
    input: Readonly<{ key: string; windowSeconds: number; max: number }>,
  ): Promise<Readonly<{ allowed: boolean }>>;
  /** The product-analytics trail; never fatal to the request. */
  trackServerEvent(
    input: Readonly<{
      userId: string;
      event: string;
      properties?: Readonly<Record<string, unknown>>;
    }>,
  ): void;

  // -- credentials ---------------------------------------------------------
  hashPassword(input: Readonly<{ password: string }>): Promise<string>;
  /** Constant-time-ish comparison of a candidate against a stored hash. */
  passwordMatches(input: Readonly<{ password: string; hash: string }>): Promise<boolean>;
  /**
   * The account row a `credential` sign-in reads, or null when the account has
   * no password at all. `password` is the stored HASH.
   */
  tryFindCredentialAccount(
    ctx: UserTrpcContext,
    input: Readonly<{ userId: string }>,
  ): Promise<Readonly<{ id: string; password: string | null }> | null>;
  /** Replaces the stored hash on one credential account row. */
  writeCredentialPassword(
    ctx: UserTrpcContext,
    input: Readonly<{ accountId: string; passwordHash: string }>,
  ): Promise<void>;
  /**
   * The Auth0 DATABASE identity (`auth0|<id>`), which is the only linked
   * identity whose password we can change. Social identities federated
   * through Auth0 are their upstream IdP's.
   */
  tryFindAuth0DatabaseAccount(
    ctx: UserTrpcContext,
    input: Readonly<{ userId: string }>,
  ): Promise<Readonly<{ providerAccountId: string }> | null>;
  changeAuth0Password(
    input: Readonly<{
      email: string;
      auth0UserId: string;
      currentPassword: string;
      newPassword: string;
    }>,
  ): Promise<Auth0PasswordChangeOutcome>;

  // -- accounts ------------------------------------------------------------
  /** Case-insensitive, because rows written before sign-in lowercased may carry capitals. */
  emailIsTaken(ctx: UserTrpcContext, input: Readonly<{ email: string }>): Promise<boolean>;
  listLinkedAccounts(
    ctx: UserTrpcContext,
    input: Readonly<{ userId: string }>,
  ): Promise<readonly Readonly<{ id: string; provider: string; providerAccountId: string }>[]>;
  /**
   * Counts and deletes under one serializable transaction, so two concurrent
   * unlinks cannot both observe two accounts and both delete.
   */
  unlinkAccount(
    ctx: UserTrpcContext,
    input: Readonly<{ userId: string; accountId: string }>,
  ): Promise<UnlinkAccountOutcome>;
  /** The CLI credentials a deactivated user must lose along with their sessions. */
  revokeCliTokensForUser(ctx: UserTrpcContext, input: Readonly<{ userId: string }>): Promise<void>;

  // -- the organization the /me dashboard is read inside -------------------
  isOrganizationMember(
    ctx: UserTrpcContext,
    input: Readonly<{ userId: string; organizationId: string }>,
  ): Promise<boolean>;
  /** Admin-configured support contact, else the first admin's address. */
  tryResolveSupportContact(
    ctx: UserTrpcContext,
    input: Readonly<{ organizationId: string }>,
  ): Promise<string | null>;
  /**
   * Who a budget-increase request goes to. Throws `no_admin_configured` when
   * the organization has no administrator — nobody holding that screen can
   * fix it, so it is the process's handled refusal rather than an empty answer.
   */
  resolveBudgetIncreaseRecipient(
    ctx: UserTrpcContext,
    input: Readonly<{ organizationId: string }>,
  ): Promise<string>;
  sendBudgetIncreaseRequest(
    ctx: UserTrpcContext,
    input: Readonly<{
      to: string;
      requesterEmail: string;
      requesterName?: string;
      organizationName: string;
      scope: string;
      scopeId: string;
      limitUsd: string;
      spentUsd: string;
      period?: string;
      message?: string;
    }>,
  ): Promise<void>;
  tryGetOrganizationName(
    ctx: UserTrpcContext,
    input: Readonly<{ organizationId: string }>,
  ): Promise<string | null>;
  tryGetUserContact(
    ctx: UserTrpcContext,
    input: Readonly<{ userId: string }>,
  ): Promise<Readonly<{ email: string | null; name: string | null }> | null>;
  /** The caller's first non-archived project in the organization, by age. */
  tryFindFirstProjectSlug(
    ctx: UserTrpcContext,
    input: Readonly<{ organizationId: string; userId: string }>,
  ): Promise<string | null>;

  // -- the /me dashboard ---------------------------------------------------
  /**
   * The routing policy a personal workspace inherits by default, reduced to
   * what the dashboard renders. Absent where the organization has none.
   */
  tryResolveDefaultRoutingPolicy(
    ctx: UserTrpcContext,
    input: Readonly<{ organizationId: string; personalTeamId: string }>,
  ): Promise<Readonly<{ id: string; name: string }> | null | undefined>;
  /** The caller's own gateway keys in this organization; only the id is read. */
  listPersonalVirtualKeys(
    ctx: UserTrpcContext,
    input: Readonly<{ userId: string; organizationId: string }>,
  ): Promise<readonly Readonly<{ id: string }>[]>;
  /** The gateway's own budget pre-check, run at a projected cost of zero. */
  checkBudget(ctx: UserTrpcContext, input: BudgetCheckInput): Promise<BudgetDecision>;
}>;

/** The gateway budget check, at the caller's own personal workspace. */
type BudgetCheckInput = Readonly<{
  organizationId: string;
  teamId: string;
  projectId: string;
  virtualKeyId: string;
  principalUserId: string;
  projectedCostUsd: number;
}>;

/** One budget the gateway weighed, as the banner and the chip read it. */
type BudgetScopeDecision = Readonly<{
  scope: string;
  scopeId: string;
  spentUsd: string;
  limitUsd: string;
  window: string;
}>;

/** The gateway's own pre-check answer, at `projectedCostUsd: 0`. */
type BudgetDecision = Readonly<{
  decision: string;
  scopes: readonly BudgetScopeDecision[];
  blockedBy: readonly BudgetScopeDecision[];
}>;

// ---------------------------------------------------------------------------
// declarations
// ---------------------------------------------------------------------------

/** Every account procedure: keyed on the session's own user id. */
const OWN_ACCOUNT: AuthzDeclaration = {
  kind: "no-permission",
  reason: "operates on the session user's own account, no tenant scope",
};

/** `deactivate` / `reactivate`: the handler checks self-or-instance-admin. */
const SELF_OR_INSTANCE_ADMIN: AuthzDeclaration = {
  kind: "no-permission",
  reason: "self-service for the named user; the handler enforces self-or-instance-admin itself",
};

const ORGANIZATION_VIEW: AuthzDeclaration = {
  kind: "permission",
  permission: "organization:view",
};

/**
 * The authenticated principal. The process's protected procedure has already
 * refused an anonymous caller; this is the same refusal, so the handlers below
 * read the session without an assertion.
 */
function sessionUserOf(ctx: UserTrpcContext): UserTrpcSession["user"] {
  const user = ctx.session?.user;
  if (!user) throw new TRPCError({ code: "UNAUTHORIZED" });
  return user;
}

/**
 * The account a preference belongs to while an operator is browsing as
 * somebody: the OPERATOR's. Their tour dismissals and admin checks are their
 * own, and must not be written onto the person they are looking at.
 */
function operatorOrSelf(ctx: UserTrpcContext): { id: string; email?: string | null } {
  const user = sessionUserOf(ctx);
  return user.impersonator ?? user;
}

/**
 * Whether a credential write may end this user's other sessions.
 *
 * Skipped while impersonating: `sessionId` is the OPERATOR's session row —
 * impersonation reuses it — so "revoke every session but this one" would
 * neither keep the subject's tab nor mean anything about the subject's
 * devices.
 */
function otherSessionsToRevoke(
  ctx: UserTrpcContext,
): Readonly<{ userId: string; keepSessionId: string }> | null {
  const user = sessionUserOf(ctx);
  const sessionId = ctx.session?.sessionId;
  if (user.impersonator || !sessionId) return null;
  return { userId: user.id, keepSessionId: sessionId };
}

/**
 * Installs the complete `user.*` tRPC surface on a process-owned root. The
 * procedures and the policy are injected by the process so its auth, audit,
 * error, logging and tracing policies wrap every feature procedure
 * consistently.
 */
export class UserTrpcApi {
  static create<
    TContext extends UserTrpcContext,
    TOptions extends TRPCRuntimeConfigOptions<TContext, object>,
    TRoot extends AnyTRPCRootTypes,
  >(
    trpc: TRPCRootObject<TContext, object, TOptions, TRoot>,
    procedures: UserTrpcProcedures<TContext, TOptions, TRoot>,
    ports: UserTrpcPorts,
  ) {
    const { protected: procedure, public: publicProcedure, policy } = procedures;

    return trpc.router({
      getTraceExplorerTourPreference: policy(OWN_ACCOUNT)(
        procedure.input(userApiEmptyInputSchema),
      ).query(async ({ ctx }) =>
        ctx.app.users.getTraceExplorerTourPreference({ id: operatorOrSelf(ctx).id }),
      ),

      dismissTraceExplorerTour: policy(OWN_ACCOUNT)(
        procedure.input(userApiEmptyInputSchema),
      ).mutation(async ({ ctx }) =>
        ctx.app.users.dismissTraceExplorerTour({ id: operatorOrSelf(ctx).id }),
      ),

      /**
       * Whether the current user is a platform admin (email listed in
       * ADMIN_EMAILS). Exposed so the client can decide whether to render
       * admin-only UI surfaces like the OPS Backoffice sidebar entry. This is
       * NOT an authorization gate — server-side admin routes enforce access
       * independently via the same check.
       */
      isAdmin: policy(OWN_ACCOUNT)(procedure.input(userApiEmptyInputSchema)).query(({ ctx }) => ({
        isAdmin: ctx.app.users.isAdmin({ email: operatorOrSelf(ctx).email }),
      })),

      register: policy(OWN_ACCOUNT)(publicProcedure.input(userApiRegisterInputSchema)).mutation(
        async ({ ctx, input }) => {
          const { name, password } = input;

          // The same rules the form ran, from the same module, so the two
          // cannot drift into accepting different passwords. Carried as
          // `fieldErrors` so the refusal lands on the password box rather
          // than in a banner over it.
          const problem = passwordProblem(password);
          if (problem) {
            throw new ValidationError(problem, {
              meta: { fieldErrors: { password: [problem] } },
            });
          }
          // BetterAuth lowercases the email on every one of its lookups and
          // writes, and sign-in goes through BetterAuth. An account stored as
          // typed, capitals and all, is therefore one that sign-in can never
          // find again, no matter the password. Store the shape sign-in will
          // search for. Customer report: onboarding signups that
          // autocapitalised the address were permanently locked out with
          // "User already exists".
          const email = input.email.toLowerCase();

          // Keyed off the RESOLVED provider, not the raw env: on an
          // SSO-capable deployment with no genuine license the platform gate
          // coerces the deployment to email mode (ADR-027 Decision 4), and
          // this tRPC path is the signup form's actual backend — blocking it
          // would kill the fresh-signup recovery route (Decision 5c).
          if ((await ports.resolveAuthProvider()) !== "email") {
            throw new TRPCError({
              code: "BAD_REQUEST",
              message: "Direct registration is not available for this auth provider",
            });
          }

          // Per-IP rate limit. Mirrors BetterAuth's `/sign-up/email`
          // 20-per-hour limit so the tRPC path can't be used as a side-channel
          // for spam signups.
          const limit = await ports.rateLimit({
            key: `user.register:${ports.clientIp(ctx)}`,
            windowSeconds: 60 * 60,
            max: 20,
          });
          if (!limit.allowed) {
            throw new TRPCError({
              code: "TOO_MANY_REQUESTS",
              message: "Too many signup attempts. Please try again later.",
            });
          }

          // Case-insensitive on purpose: rows written before the lowercasing
          // above (or seeded by other means) may carry capitals, and minting a
          // case-twin beside one would leave two Users answering for one human.
          if (await ports.emailIsTaken(ctx, { email })) {
            throw new EmailAlreadyRegisteredError();
          }

          const newUser = await ctx.app.users.createCredentialUser({
            name: name ?? null,
            email,
            passwordHash: await ports.hashPassword({ password }),
          });
          ports.trackServerEvent({ userId: newUser.id, event: "signed_up" });

          return { id: newUser.id };
        },
      ),

      updateLastLogin: policy(OWN_ACCOUNT)(procedure.input(userApiEmptyInputSchema)).mutation(
        async ({ ctx }) => {
          // Don't update lastLoginAt for impersonated sessions — an admin
          // browsing as another user should not overwrite that user's
          // last-login timestamp with the admin's activity.
          const user = sessionUserOf(ctx);
          if (user.impersonator) return;

          await ctx.app.users.updateLastLogin({ id: user.id });
        },
      ),

      getSsoStatus: policy(OWN_ACCOUNT)(procedure.input(userApiEmptyInputSchema)).query(
        async ({ ctx }) => ctx.app.users.getSsoStatus({ id: sessionUserOf(ctx).id }),
      ),

      getAccountInfo: policy(OWN_ACCOUNT)(procedure.input(userApiEmptyInputSchema)).query(
        async ({ ctx }) => ctx.app.users.getAccountInfo({ id: sessionUserOf(ctx).id }),
      ),

      getLinkedAccounts: policy(OWN_ACCOUNT)(procedure.input(userApiEmptyInputSchema)).query(
        async ({ ctx }) => ports.listLinkedAccounts(ctx, { userId: sessionUserOf(ctx).id }),
      ),

      unlinkAccount: policy(OWN_ACCOUNT)(procedure.input(userApiUnlinkAccountInputSchema)).mutation(
        async ({ ctx, input }) => {
          // The count and the delete run in ONE serializable transaction. Done
          // as separate statements with no isolation, two concurrent unlink
          // calls (a user double-clicking the X) could both observe two
          // accounts, both pass the "last account" guard, and both delete —
          // leaving the user with zero accounts and no way to sign in.
          const outcome = await ports.unlinkAccount(ctx, {
            userId: sessionUserOf(ctx).id,
            accountId: input.accountId,
          });
          if (outcome === "last_account") {
            throw new TRPCError({
              code: "BAD_REQUEST",
              message: "Cannot remove the last authentication method",
            });
          }
          if (outcome === "not_found") {
            throw new TRPCError({ code: "NOT_FOUND", message: "Account not found" });
          }

          return { success: true };
        },
      ),

      /**
       * Whether to offer this person a passkey right now (ADR-120).
       *
       * Three conditions, and the first is the one that keeps it from being
       * noise: somebody who already HOLDS a passkey is never asked, whatever
       * they signed in with today — a member on a machine that does not hold
       * theirs has a good reason, and asking them to make another is a nag
       * with no upside.
       *
       * The interval lives on the account rather than in browser storage, so
       * a new device does not restart the count and the 30 days actually mean
       * 30 days.
       */
      passkeyNudge: policy(OWN_ACCOUNT)(procedure.input(userApiEmptyInputSchema)).query(
        async ({ ctx }) => {
          if (!ports.deploymentOffersPasskeys()) return { offer: false };

          const nudge = await ctx.app.users.getPasskeyNudgeStatus({
            id: sessionUserOf(ctx).id,
          });
          if (nudge.hasPasskey) return { offer: false };

          const dismissedAt = nudge.dismissedAt;
          if (!dismissedAt) return { offer: true };

          const askAgainAfter =
            dismissedAt.getTime() + PASSKEY_NUDGE_INTERVAL_DAYS * 24 * 60 * 60_000;
          return { offer: Date.now() >= askAgainAfter };
        },
      ),

      /**
       * "Not now". Dated rather than flagged, because the offer comes back — a
       * flag would make one dismissal permanent, and somebody who declines on
       * the day they sign up is not somebody who never wants a passkey.
       */
      dismissPasskeyNudge: policy(OWN_ACCOUNT)(procedure.input(userApiEmptyInputSchema)).mutation(
        async ({ ctx }) => {
          await ctx.app.users.dismissPasskeyNudge({ id: sessionUserOf(ctx).id });
          return { success: true };
        },
      ),

      /**
       * Whether the session user can sign in with a password.
       *
       * The settings page needs it to know which of two things to offer:
       * changing a password, or setting a first one. Passkey sign-up and SSO
       * both produce accounts with no password at all, and offering "Change
       * password" to somebody who has none is an offer that can only fail.
       */
      hasPassword: policy(OWN_ACCOUNT)(procedure.input(userApiEmptyInputSchema)).query(
        async ({ ctx }) => ({
          hasPassword: await ctx.app.users.hasPassword({ id: sessionUserOf(ctx).id }),
        }),
      ),

      /**
       * Set a FIRST password, for an account that has none.
       *
       * A passkey is the better credential and this does not argue otherwise.
       * But an account whose only way in is one device is an account one lost
       * phone away from a support ticket, and the recovery that would rescue
       * it — "forgot password" — updates credential rows in place: with no
       * password ever set it matched nothing and reported success, which is a
       * reset that silently does nothing.
       *
       * It can only ever FILL AN EMPTY SLOT. Where a password already exists
       * this refuses and `changePassword` is the way, which is what keeps it
       * from becoming a no-proof overwrite of somebody's credential: a stolen
       * session can already read everything, and the thing worth denying it is
       * a credential that outlives the session being revoked. Setting the
       * first one still hands it persistence, so the attempt is throttled, and
       * every other session is ended the moment it lands.
       */
      setPassword: policy(OWN_ACCOUNT)(procedure.input(userApiSetPasswordInputSchema)).mutation(
        async ({ ctx, input }) => {
          // The same rules the form ran, from the same module, so the two
          // cannot drift into accepting different passwords.
          const problem = passwordProblem(input.password);
          if (problem) {
            throw new ValidationError(problem, {
              meta: { fieldErrors: { password: [problem] } },
            });
          }

          // Email mode only. Under Auth0 the password lives in the Auth0
          // tenant and this row is not where it would go.
          if ((await ports.resolveAuthProvider()) !== "email") {
            throw new TRPCError({
              code: "BAD_REQUEST",
              message: "Passwords are not available for this auth provider",
            });
          }

          const user = sessionUserOf(ctx);
          const limit = await ports.rateLimit({
            key: `user.setPassword:${user.id}`,
            windowSeconds: 60 * 15,
            max: 5,
          });
          if (!limit.allowed) {
            throw new TRPCError({
              code: "TOO_MANY_REQUESTS",
              message: "Too many attempts. Please try again later.",
            });
          }

          const result = await ctx.app.users.setFirstPassword({
            id: user.id,
            passwordHash: await ports.hashPassword({ password: input.password }),
          });
          if (result === "already_set") {
            throw new TRPCError({
              code: "BAD_REQUEST",
              message:
                "This account already has a password. Change it instead of setting a new one.",
            });
          }

          // Every other session ends. A password is a credential that outlives
          // session revocation, so anything else holding a session at the
          // moment one appears must not keep it.
          const revoke = otherSessionsToRevoke(ctx);
          if (revoke) await ctx.app.users.revokeOtherBrowserSessions(revoke);

          return { success: true };
        },
      ),

      changePassword: policy(OWN_ACCOUNT)(
        procedure.input(userApiChangePasswordInputSchema),
      ).mutation(async ({ ctx, input }) => {
        // Resolved provider, not raw env (ADR-027): on a denied SSO
        // deployment the platform gate coerces to email mode, and a user who
        // recovered via the v6 password-reset path owns a `credential`
        // account — they must be able to change it (the coerced UI offers the
        // button). `changePassword` requires the current password, so this is
        // not the takeover vector Decision 4's all-states block guards against.
        const provider = await ports.resolveAuthProvider();
        if (provider !== "email" && provider !== "auth0") {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Password changes are not available for this auth provider",
          });
        }

        const user = sessionUserOf(ctx);

        // Per-user rate limit. BetterAuth's `/change-password` endpoint is
        // gated by `sensitiveSessionMiddleware` which forces recent
        // re-authentication; this tRPC mutation does NOT, so without a
        // throttle a stolen session token could be used to brute-force the
        // `currentPassword` to recover the user's plaintext (bcrypt is slow
        // but not infinite). 5 attempts per 15 minutes per user mirrors
        // `/forget-password`'s budget. Applies to the Auth0 path too — both to
        // throttle brute-force against the Auth0 Authentication API and to
        // avoid hammering Auth0 rate limits.
        const limit = await ports.rateLimit({
          key: `user.changePassword:${user.id}`,
          windowSeconds: 60 * 15,
          max: 5,
        });
        if (!limit.allowed) {
          throw new TRPCError({
            code: "TOO_MANY_REQUESTS",
            message: "Too many password change attempts. Please try again later.",
          });
        }

        if (provider === "auth0") {
          // Only the Auth0 database connection (`auth0|<id>`
          // providerAccountId) has a password we can update via the
          // Management API. Social identities linked through Auth0
          // (google-oauth2|..., github|..., windowslive|...) are managed by
          // their upstream IdPs.
          const auth0Account = await ports.tryFindAuth0DatabaseAccount(ctx, { userId: user.id });

          if (!auth0Account) {
            throw new TRPCError({
              code: "NOT_FOUND",
              message:
                "No Auth0 database (Email/Password) account is linked to this user. Password changes are only supported for that sign-in method.",
            });
          }

          if (!user.email) {
            throw new TRPCError({
              code: "INTERNAL_SERVER_ERROR",
              message: "Authenticated session is missing an email",
            });
          }

          const result = await ports.changeAuth0Password({
            email: user.email,
            auth0UserId: auth0Account.providerAccountId,
            currentPassword: input.currentPassword,
            newPassword: input.newPassword,
          });
          if (result.outcome !== "changed") throw auth0Refusal(result);

          // Auth0's OIDC sessions are managed by the Auth0 tenant, but the
          // LangWatch *app* session is a row in our own store and is NOT
          // invalidated by the Management API password change. Revoke other
          // devices' app sessions so a stolen session token cannot outlive a
          // password rotation. Same impersonation safeguard as the email path.
          const revokeAuth0 = otherSessionsToRevoke(ctx);
          if (revokeAuth0) await ctx.app.users.revokeOtherBrowserSessions(revokeAuth0);
          return { success: true };
        }

        const credentialAccount = await ports.tryFindCredentialAccount(ctx, { userId: user.id });

        if (!credentialAccount?.password) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "User not found or password not set",
          });
        }

        const passwordMatch = await ports.passwordMatches({
          password: input.currentPassword,
          hash: credentialAccount.password,
        });
        if (!passwordMatch) {
          throw new TRPCError({
            code: "UNAUTHORIZED",
            message: "Current password is incorrect",
          });
        }

        await ports.writeCredentialPassword(ctx, {
          accountId: credentialAccount.id,
          passwordHash: await ports.hashPassword({ password: input.newPassword }),
        });

        // Best practice: invalidate all OTHER sessions of this user after a
        // password change. The current tab stays logged in (the user just
        // re-authenticated by typing the current password); any other device
        // or stolen session is force-logged-out.
        const revoke = otherSessionsToRevoke(ctx);
        if (revoke) await ctx.app.users.revokeOtherBrowserSessions(revoke);

        return { success: true };
      }),

      deactivate: policy(SELF_OR_INSTANCE_ADMIN)(procedure.input(userApiUserInputSchema)).mutation(
        async ({ ctx, input }) => {
          const user = sessionUserOf(ctx);
          if (
            input.userId !== user.id &&
            !ctx.app.users.isAdmin({ email: operatorOrSelf(ctx).email })
          ) {
            throw new TRPCError({ code: "FORBIDDEN" });
          }

          // User owns the durable state transition. The process-level lifecycle
          // services own the effects that follow it: browser sessions and CLI
          // credentials must be revoked without injecting Auth or Governance
          // callback ports into User (which would create a service cycle).
          await ctx.app.users.deactivate({ id: input.userId });
          await ctx.app.users.revokeAllBrowserSessions({ userId: input.userId });
          await ports.revokeCliTokensForUser(ctx, { userId: input.userId });
          return { success: true };
        },
      ),

      reactivate: policy(SELF_OR_INSTANCE_ADMIN)(procedure.input(userApiUserInputSchema)).mutation(
        async ({ ctx, input }) => {
          if (!ctx.app.users.isAdmin({ email: operatorOrSelf(ctx).email })) {
            throw new TRPCError({ code: "FORBIDDEN" });
          }

          await ctx.app.users.reactivate({ id: input.userId });
          return { success: true };
        },
      ),

      /**
       * Uploads and sets the caller's own avatar photo. The image is stored in
       * the object store (owned by the user, under their personal workspace)
       * and its serve URL is written to the field every avatar surface
       * resolves through. `organizationId` scopes the personal-workspace
       * resolution and is permission-checked.
       *
       * Spec: specs/settings/user-avatar.feature
       */
      setAvatar: policy(ORGANIZATION_VIEW)(procedure.input(userApiSetAvatarInputSchema)).mutation(
        async ({ ctx, input }) => {
          const user = sessionUserOf(ctx);
          // Throttle uploads per user — each writes bytes to object storage
          // and updates the row; mirrors the changePassword budget shape.
          const limit = await ports.rateLimit({
            key: `user.setAvatar:${user.id}`,
            windowSeconds: 60,
            max: 10,
          });
          if (!limit.allowed) {
            throw new UserAvatarRateLimitedError();
          }

          // `UserAvatarValidationError` is a handled error, so the process's
          // handled-error middleware carries its code and meta to the client
          // on its own. Catching it here to rewrap it as a BAD_REQUEST would
          // only replace the code with the raw message — the thing #5984
          // closed.
          return await ctx.app.users.setAvatar({
            userId: user.id,
            organizationId: input.organizationId,
            imageDataUrl: input.imageDataUrl,
            displayName: user.name,
            displayEmail: user.email,
          });
        },
      ),

      /**
       * Clears the caller's uploaded avatar so surfaces fall back to their SSO
       * photo (if any) and then their initials.
       *
       * Spec: specs/settings/user-avatar.feature
       */
      removeAvatar: policy(OWN_ACCOUNT)(procedure.input(userApiEmptyInputSchema)).mutation(
        async ({ ctx }) => {
          await ctx.app.users.removeAvatar({ userId: sessionUserOf(ctx).id });
          return { success: true };
        },
      ),

      /**
       * Personal context for a user inside an organization. Backs the /me
       * dashboard's personal-context hook.
       *
       * Lazily provisions the personal workspace on first call so existing
       * users (who joined the organization before this feature shipped) get
       * one without re-accepting an invite.
       */
      personalContext: policy(ORGANIZATION_VIEW)(
        procedure.input(userApiOrganizationInputSchema),
      ).query(async ({ ctx, input }) => {
        const user = sessionUserOf(ctx);

        // Caller must be a member of the organization.
        await assertMember(ports, ctx, user.id, input.organizationId);

        const workspace = await ctx.app.users.ensurePersonalWorkspace({
          userId: user.id,
          organizationId: input.organizationId,
          displayName: user.name,
          displayEmail: user.email,
        });

        const defaultPolicy = await ports.tryResolveDefaultRoutingPolicy(ctx, {
          organizationId: input.organizationId,
          personalTeamId: workspace.team.id,
        });

        return {
          workspace,
          routingPolicy: defaultPolicy ? { id: defaultPolicy.id, name: defaultPolicy.name } : null,
        };
      }),

      /**
       * Per-user budget state powering the /me dashboard's budget banner. Same
       * wire shape as the CLI 402 payload so client and CLI render with
       * identical fields.
       *
       * Delegates to the gateway's own budget check with
       * `projectedCostUsd: 0` — the same code path the gateway uses at request
       * time, so the UI's banner state and the CLI's pre-check decision can
       * never disagree.
       *
       * Returns:
       *   { status: "ok" }                    nothing to render
       *   { status: "warning", ...details }    at or over 80% used
       *   { status: "exceeded", ...details }   at or over 100% used
       *
       * Graceful-degradation cases that answer `{ status: "ok" }`: no personal
       * workspace yet, no personal virtual key yet, and a deployment with no
       * analytics store configured.
       */
      personalBudget: policy(ORGANIZATION_VIEW)(
        procedure.input(userApiOrganizationInputSchema),
      ).query(async ({ ctx, input }) => {
        const user = sessionUserOf(ctx);

        const workspace = await ctx.app.users.tryFindPersonalWorkspace({
          userId: user.id,
          organizationId: input.organizationId,
        });
        if (!workspace) return { status: "ok" as const };

        const vks = await ports.listPersonalVirtualKeys(ctx, {
          userId: user.id,
          organizationId: input.organizationId,
        });
        const personalVk = vks[0];
        // OTLP-only users intentionally have no personal virtual key — they
        // keep their existing provider seat and rely on their agent's OTLP
        // exporter. They still need budget visibility on the principal scope.
        // Use a sentinel virtual-key id that won't match any key-scoped
        // budget; principal-scope budgets resolve via `principalUserId`
        // regardless. Mirrors the pattern the ingestion-source receiver uses
        // on ledger writes.
        const sentinelVk = `_ingestion_:user:${user.id}`;

        const decision = await ports.checkBudget(ctx, {
          organizationId: input.organizationId,
          teamId: workspace.team.id,
          projectId: workspace.project.id,
          virtualKeyId: personalVk?.id ?? sentinelVk,
          principalUserId: user.id,
          projectedCostUsd: 0,
        });

        // Status mapping: hard_block -> exceeded (red banner), soft_warn ->
        // warning (yellow banner), allow -> ok (no banner). The chip on /me
        // however needs always-on snapshot data so it can render a budget name
        // and "13% spent" even under the 80% banner threshold. Pick the best
        // applicable budget regardless of decision and pass through
        // spent/limit — the warning/exceeded banners still gate on `status`,
        // so "ok" suppresses banners and only the chip data flows through.
        // Caught when a MEMBER running OTLP-only had a real principal-scope
        // budget at 13% but the chip read "No budget set" — the early return
        // on allow threw away the snapshot fields the chip needed.
        const sortedScopes = decision.scopes
          .map((scope) => ({ ...scope, pctUsed: percentUsed(scope.spentUsd, scope.limitUsd) }))
          .sort((a, b) => b.pctUsed - a.pctUsed);
        // `blockedBy` carries the same scopes without the derived percentage,
        // so it is mapped the same way rather than tested for the field: a
        // `"pctUsed" in topScope` guard over the union typed the value
        // `unknown`, and the comparison below silently never fired for a
        // blocking scope.
        const blocking = decision.blockedBy[0];
        const topScope = blocking
          ? { ...blocking, pctUsed: percentUsed(blocking.spentUsd, blocking.limitUsd) }
          : sortedScopes[0];
        if (!topScope) return { status: "ok" as const };

        const baseStatus =
          decision.decision === "hard_block"
            ? ("exceeded" as const)
            : decision.decision === "soft_warn" || topScope.pctUsed >= 80
              ? ("warning" as const)
              : ("ok" as const);

        // Display-facing contact: prefers the admin-configured support
        // contact (an address, a URL, or a short instruction), and falls back
        // to the first admin's address.
        const adminEmail = await ports.tryResolveSupportContact(ctx, {
          organizationId: input.organizationId,
        });
        return {
          status: baseStatus,
          scope: normalizeScope(topScope.scope),
          spentUsd: topScope.spentUsd,
          limitUsd: topScope.limitUsd,
          period: topScope.window.toLowerCase(),
          requestIncreaseUrl: requestIncreaseUrl({
            baseUrl: ports.appBaseUrl(),
            scope: normalizeScope(topScope.scope),
            scopeId: topScope.scopeId,
            limitUsd: topScope.limitUsd,
            spentUsd: topScope.spentUsd,
          }),
          adminEmail,
        };
      }),

      /**
       * Submit a budget-increase request to the organization's admin.
       * Triggered from the budget-request page (linked from the gateway's 402
       * `request_increase_url` and from the CLI's request-increase command).
       * Resolves the recipient, then mails them the user, scope, limit, spent,
       * and optional free-form message.
       */
      requestBudgetIncrease: policy(ORGANIZATION_VIEW)(
        procedure.input(userApiRequestBudgetIncreaseInputSchema),
      ).mutation(async ({ ctx, input }) => {
        const user = sessionUserOf(ctx);
        const adminEmail = await ports.resolveBudgetIncreaseRecipient(ctx, {
          organizationId: input.organizationId,
        });
        const [organizationName, requester] = await Promise.all([
          ports.tryGetOrganizationName(ctx, { organizationId: input.organizationId }),
          ports.tryGetUserContact(ctx, { userId: user.id }),
        ]);
        try {
          await ports.sendBudgetIncreaseRequest(ctx, {
            to: adminEmail,
            requesterEmail: requester?.email ?? user.email ?? "",
            requesterName: requester?.name ?? undefined,
            organizationName: organizationName ?? "",
            scope: input.scope,
            scopeId: input.scopeId,
            limitUsd: input.limitUsd,
            spentUsd: input.spentUsd,
            period: input.period,
            message: input.message,
          });
        } catch (err) {
          logger.error(
            { err, organizationId: input.organizationId },
            "failed to send budget increase request email",
          );
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: "email_send_failed",
          });
        }
        return { ok: true as const, sentTo: adminEmail };
      }),

      /**
       * Persist (or clear) the user's pinned home destination. Null clears the
       * pin and reverts to auto-detection. The picker calls this when the user
       * chooses a destination from the dropdown.
       *
       * Spec: specs/ai-gateway/governance/persona-home-content.feature
       *       (user pin > organization pin > auto-detection priority)
       */
      setLastHomePath: policy(OWN_ACCOUNT)(
        procedure.input(userApiSetLastHomePathInputSchema),
      ).mutation(async ({ ctx, input }) => {
        await ctx.app.users.setLastHomePath({
          id: sessionUserOf(ctx).id,
          path: input.path,
        });
        return { ok: true as const };
      }),

      /**
       * Snapshot of the user's home-page picker state: the currently-pinned
       * path (if any) plus the first project the auto-detected default would
       * land on. One round trip, so the picker doesn't compose several
       * queries.
       *
       * The governance-home option is shown for any user who could possibly
       * land there via auto-detection — the picker asks the home resolver for
       * the auto-detected destination rather than duplicating that logic here.
       */
      homePagePickerState: policy(ORGANIZATION_VIEW)(
        procedure.input(userApiOrganizationInputSchema),
      ).query(async ({ ctx, input }) => {
        const userId = sessionUserOf(ctx).id;
        const [lastHomePath, firstProjectSlug] = await Promise.all([
          ctx.app.users.tryGetLastHomePath({ id: userId }),
          ports.tryFindFirstProjectSlug(ctx, {
            organizationId: input.organizationId,
            userId,
          }),
        ]);
        return { lastHomePath, firstProjectSlug };
      }),
    });
  }
}

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

/**
 * Membership, checked again after `organization:view`. The permission answers
 * "may this caller act on an organization at all"; this answers "is this one
 * theirs", which is what keeps a personal rollup inside the caller's own
 * tenant.
 */
async function assertMember(
  ports: Pick<UserTrpcPorts, "isOrganizationMember">,
  ctx: UserTrpcContext,
  userId: string,
  organizationId: string,
): Promise<void> {
  if (await ports.isOrganizationMember(ctx, { userId, organizationId })) return;
  throw new TRPCError({
    code: "FORBIDDEN",
    message: `Not a member of organization ${organizationId}`,
  });
}

/** The refusal for each way the Auth0 tenant can decline a password change. */
function auth0Refusal(result: Auth0PasswordChangeOutcome): TRPCError {
  switch (result.outcome) {
    case "wrong_password":
      return new TRPCError({
        code: "UNAUTHORIZED",
        message: "Current password is incorrect",
      });
    case "weak_password":
      // The Auth0 tenant's policy rejected the new password — show its
      // message verbatim so the user knows what to fix.
      return new TRPCError({ code: "BAD_REQUEST", message: result.message });
    case "insufficient_scope":
      return new TRPCError({
        code: "INTERNAL_SERVER_ERROR",
        message:
          "Auth0 is not authorized to update users. Ask an administrator to enable the update:users scope on the Auth0 Management M2M application.",
      });
    case "password_grant_not_enabled":
      return new TRPCError({
        code: "INTERNAL_SERVER_ERROR",
        message:
          "Auth0 Password grant is not enabled on the Management M2M application. Ask an administrator to enable it under that application's Advanced Settings → Grant Types.",
      });
    case "not_configured":
      return new TRPCError({
        code: "INTERNAL_SERVER_ERROR",
        message:
          "Auth0 is not configured on the server. Set AUTH0_ISSUER plus AUTH0_MGMT_CLIENT_ID/SECRET (or AUTH0_CLIENT_ID/SECRET).",
      });
    default:
      return new TRPCError({
        code: "INTERNAL_SERVER_ERROR",
        message: "Could not update password with Auth0. Please try again later.",
      });
  }
}

function percentUsed(spentUsd: string, limitUsd: string): number {
  const limit = Number.parseFloat(limitUsd);
  if (!Number.isFinite(limit) || limit <= 0) return 0;
  const spent = Number.parseFloat(spentUsd);
  return (spent / limit) * 100;
}

/**
 * Map server-side scope codes to the wire-shape values the budget banner and
 * the CLI's budget box accept.
 */
function normalizeScope(scope: string): string {
  const normalized = scope.toLowerCase();
  // Virtual-key-scope blocks are surfaced as "personal" in the user-facing
  // banner — that matches the CLI's normalization.
  if (normalized === "virtual_key") return "personal";
  return normalized;
}

function requestIncreaseUrl(opts: {
  baseUrl: string | null;
  scope: string;
  scopeId: string;
  limitUsd: string;
  spentUsd: string;
}): string | undefined {
  if (!opts.baseUrl) return undefined;
  const params = new URLSearchParams({
    scope: opts.scope,
    scope_id: opts.scopeId,
    limit_usd: opts.limitUsd,
    spent_usd: opts.spentUsd,
  });
  return `${opts.baseUrl.replace(/\/$/, "")}/me/budget/request?${params.toString()}`;
}
