export type {
  AuthenticationResponseJSON,
  PublicKeyCredentialCreationOptionsJSON,
  PublicKeyCredentialRequestOptionsJSON,
} from "@simplewebauthn/server";
import { passkey } from "@better-auth/passkey";
import type { SSOUserResolution, SSOUserResolutionInput } from "@better-auth/sso";
import { sso } from "@better-auth/sso";
import {
  isCredentialMutationPath,
  isEmailAuthPath,
  isGateDependentPath,
  isGatedSsoPath,
  isPasswordResetPath,
  normalizedRequestPathname,
  requestPathname,
  type AuthApi,
} from "@langwatch/auth-contract";
import type { SignInMethodPolicy, SsoAssertionApi } from "@langwatch/identity-contract";
import { createLogger } from "@langwatch/observability";
import type { RedisConnection } from "@langwatch/redis-client";
import { fromDate } from "@langwatch/time";
import type { UserApi } from "@langwatch/user-contract";
import { compare, hash } from "bcrypt";
import { type BetterAuthOptions, betterAuth } from "better-auth";
import { APIError, createAuthMiddleware } from "better-auth/api";
import { genericOAuth } from "better-auth/plugins/generic-oauth";
import { twoFactor } from "better-auth/plugins/two-factor";

import type { BetterAuthHooksRepository } from "../../repositories/better-auth-hooks.repository.ts";
import { findRegisteredRefusals } from "../../rules/better-auth-error-code.rules.ts";
import {
  findSubmittedAddresses,
  isLockoutCountedPath,
} from "../../rules/sign-in-identifier-hash.rules.ts";
import { resolveTrustedOrigins } from "../../rules/trusted-origins.rules.ts";
import type {
  BetterAuthAnnouncements,
  BetterAuthFederation,
  BetterAuthIdentityCeremonies,
  BetterAuthPendingInvite,
  BetterAuthStorage,
} from "../better-auth.channel.ts";
import {
  afterAccountCreate,
  afterAccountUpdate,
  afterSessionCreate,
  afterUserCreate,
  createBeforeAccountCreateHook,
  createBeforeSessionCreateHook,
  beforeUserCreate,
  type BetterAuthHookCollaborators,
} from "./http.better-auth-hooks.channel.ts";
import type { CredentialSessionGuard } from "./http.credential-session-guard.channel.ts";
import {
  passkeySignUpRegistration,
  type SignUpVerification,
} from "./http.passkey-sign-up.channel.ts";
import {
  runSignInRouterShadow,
  type SignInRouterShadow,
} from "./http.sign-in-router-shadow.channel.ts";

const logger = createLogger("langwatch:better-auth");

/**
 * Everything about this deployment the option set is built from.
 */
export type BetterAuthDeploymentConfiguration = Readonly<{
  /** `betterAuth({ baseURL })` — where this instance believes it is served. */
  baseUrl: string;
  /**
   * The externally reachable origin, where a proxy makes it differ from {@link baseUrl}.
   */
  publicBaseUrl?: string | undefined;
  /** The signing secret. Never logged, never reported, never defaulted. */
  secret: string;
  /**
   * Whether the email/password routes MOUNT. See {@link isEmailPasswordEnabled}
   * for the rule; mounting is not the gate, the request hook is.
   */
  emailPasswordEnabled: boolean;
  /** Whether the two-factor plugin is mounted. */
  mfaEnrollmentOpen: boolean;
  /** Whether the passkey plugin is mounted. */
  passkeysEnabled: boolean;
  /** Salts the provisional handle a passkey sign-up ceremony is minted with. */
  passkeyHandleSecret: string;
  /** `SSO_TRUSTED_IDP_ORIGINS`: an operator's own allowlist of identity
   *  providers, honoured everywhere. See {@link resolveTrustedOrigins}. */
  trustedIdpOrigins?: string | undefined;
  /** `LANGWATCH_IDPSIM_URL`: the simulator a worktree runs, trusted outside
   *  production only. */
  idpSimulatorUrl?: string | undefined;
  /** Whether this is a production deployment — the process's own fact. */
  isProduction: boolean;
  /** Social providers this deployment mounted, already built. */
  socialProviders: NonNullable<BetterAuthOptions["socialProviders"]>;
  /** Generic-OIDC connections this deployment mounted, already built. */
  genericOAuthConfigs: readonly Parameters<typeof genericOAuth>[0]["config"][number][];
}>;

/**
 * Whether BetterAuth's email/password (credentials) routes are MOUNTED.
 * (ADR-027). Mounting is not the gate: the `before` hook below is what blocks
 */
export const isEmailPasswordEnabled = (deployment: {
  authProvider: string | undefined;
  isSaas: boolean;
  localPasswords: boolean;
}): boolean =>
  deployment.authProvider === "email" || !deployment.isSaas || deployment.localPasswords;

/**
 * Seals better-auth's own sign-up route unconditionally, before any licence
 * is read: creation belongs to `user.register`'s pending-confirmation latch,
 * else email-mode (the common case) would stay wide open to the raw route.
 */
function refuseDirectEmailSignUp(pathname: string): void {
  if (!pathname.endsWith("/sign-up/email")) return;

  throw APIError.from("NOT_FOUND", { code: "NOT_FOUND", message: "Not found" });
}

/**
 * Whether a licensed deployment should refuse this credential route, the
 * ADR-027 gate site #3 decision.
 * ADR-117 §4 is what changed here, and only in mechanism: the question used to
 */
function refusesCredentialRoute({
  pathname,
  isResetPath,
  policy,
}: {
  pathname: string;
  isResetPath: boolean;
  policy: SignInMethodPolicy;
}): boolean {
  if (!isResetPath && !isEmailAuthPath(pathname)) return false;
  // D09: a deployment that offers a password answers the form it just drew.
  if (policy.defaultMethods.some((method) => method.kind === "password")) return false;

  return policy.defaultMethods.some((method) => method.kind === "federated");
}

/** Whether an organization's own connection governs this address (D04). */
export type AddressRoutesToConnection = (input: { email: string }) => Promise<boolean>;

/**
 * A password reset for an address an organization signs in through its own
 * provider would mint the local password that connection exists to prevent,
 * one email later - refused in every mode. An address-less request passes.
 */
async function refuseConnectionGovernedReset({
  pathname,
  body,
  addressRoutesToConnection,
}: {
  pathname: string;
  body: unknown;
  addressRoutesToConnection: AddressRoutesToConnection;
}): Promise<void> {
  if (!isPasswordResetPath(pathname)) return;

  const [email] = findSubmittedAddresses(body);
  if (email === undefined) return;
  if (!(await addressRoutesToConnection({ email }))) return;

  throw APIError.from("BAD_REQUEST", {
    code: "EMAIL_PASSWORD_DISABLED",
    message:
      "Credential management is disabled — your account is managed by your identity provider.",
  });
}

/**
 * The part of the lock-out service these hooks may reach (GAC-09). Narrower
 * on purpose: a hook may refuse an attempt and record how it went, and may
 * never release a hold - that is an administrator's act.
 */
export interface SignInAttemptCounter {
  refuseIfLockedOut(input: { identifier: string }): Promise<void>;
  recordFailure(input: { identifier: string }): Promise<void>;
  recordSuccess(input: { identifier: string }): Promise<void>;
}

/**
 * Records how a counted sign-in attempt went (GAC-09). Its failure is
 * swallowed: the endpoint has answered, so nothing here changes the outcome.
 */
export async function countSignInAttempt({
  ctx,
  signInLockout,
}: {
  ctx: { request?: { url?: string }; body?: unknown; context?: { returned?: unknown } };
  signInLockout: SignInAttemptCounter;
}): Promise<void> {
  const pathname = normalizedRequestPathname(ctx.request?.url ?? "");
  if (!isLockoutCountedPath(pathname)) return;

  const [identifier] = findSubmittedAddresses(ctx.body);
  if (identifier === undefined) return;

  const refused = ctx.context?.returned instanceof APIError;
  try {
    await (refused
      ? signInLockout.recordFailure({ identifier })
      : signInLockout.recordSuccess({ identifier }));
  } catch (error) {
    logger.warn(
      { error, refused },
      "could not record how a sign-in attempt went; the attempt itself already answered",
    );
  }
}

/**
 * A refusal on a translated route family re-answered under its registered code, status and
 * headers kept, so the browser's registry has words for it (main's handled-errors table).
 * Server-side calls carry no request and stay untouched.
 */
export function answerAuthRefusalByRegisteredCode(ctx: {
  request?: { url?: string };
  context?: { returned?: unknown };
}): void {
  const url = ctx.request?.url;
  if (url === undefined) return;

  const returned = ctx.context?.returned;
  if (!(returned instanceof APIError)) return;

  const betterAuthCode = returned.body?.code;
  if (betterAuthCode === undefined) return;

  const pathname = normalizedRequestPathname(url);
  const [refusal] = findRegisteredRefusals({ pathname, betterAuthCode });
  if (refusal === undefined) return;

  logger.warn(
    { path: pathname, betterAuthCode, code: refusal.code },
    "an auth endpoint refused, and it is answered under its registered code",
  );
  throw APIError.from(returned.status, { code: refusal.code, message: refusal.code });
}

/**
 * GAC-09, and asked FIRST: checking the password before the lock lets
 * somebody keep testing passwords and simply not be told the answer, with the
 * timing of the response telling them anyway.
 */
async function refuseLockedOutAddress({
  pathname,
  body,
  signInLockout,
}: {
  pathname: string;
  body: unknown;
  signInLockout: SignInAttemptCounter;
}): Promise<void> {
  if (!isLockoutCountedPath(pathname)) return;

  const [attempted] = findSubmittedAddresses(body);
  if (attempted === undefined) return;

  await signInLockout.refuseIfLockedOut({ identifier: attempted });
}

function createBeforeRequestHook({
  federation,
  shadow,
  signInLockout,
  addressRoutesToConnection,
}: {
  federation: BetterAuthFederation;
  shadow: SignInRouterShadow;
  signInLockout: SignInAttemptCounter;
  addressRoutesToConnection: AddressRoutesToConnection;
}): NonNullable<BetterAuthOptions["hooks"]>["before"] {
  return async (ctx) => {
    const url = ctx.request?.url ?? "";
    const pathname = normalizedRequestPathname(url);

    await refuseLockedOutAddress({ pathname, body: ctx.body, signInLockout });
    refuseDirectEmailSignUp(pathname);
    await runSignInRouterShadow({ pathname, url, body: ctx.body, shadow });

    await refuseConnectionGovernedReset({ pathname, body: ctx.body, addressRoutesToConnection });

    if (!federation.federationCapable()) return;

    if (isCredentialMutationPath(pathname)) {
      throw APIError.from("BAD_REQUEST", {
        code: "EMAIL_PASSWORD_DISABLED",
        message:
          "Credential management is disabled in cloud/SSO mode — your account is managed by your identity provider.",
      });
    }

    const isResetPath = isPasswordResetPath(pathname);
    if (!isGateDependentPath(url)) return;

    const policy = await federation.resolveSignInMethodPolicy();
    if (policy.federationLicensed) {
      if (refusesCredentialRoute({ pathname, isResetPath, policy })) {
        throw APIError.from("BAD_REQUEST", {
          code: "EMAIL_PASSWORD_DISABLED",
          message:
            "Credential management is disabled — your account is managed by your identity provider.",
        });
      }
      return;
    }

    if (!isResetPath && isGatedSsoPath(url)) {
      logger.warn(
        { path: requestPathname(url), reason: "no_license" },
        "Blocked SSO request: deployment has no genuine license",
      );
      throw APIError.from("FORBIDDEN", {
        code: "SSO_LICENSE_REQUIRED",
        message:
          "SSO is not available on this deployment — sign in with your email and password instead.",
      });
    }
  };
}

/**
 * Builds the Better Auth transport around the process-owned mailer.
 */
export const createAuthOptions = ({
  repo,
  deployment,
  storage,
  federation,
  identity,
  shadow,
  hooks,
  ssoIssuers,
  credentialGuard,
  signInLockout,
  addressRoutesToConnection,
}: {
  repo: BetterAuthHooksRepository;
  deployment: BetterAuthDeploymentConfiguration;
  storage: BetterAuthStorage;
  federation: BetterAuthFederation;
  identity: BetterAuthIdentityCeremonies;
  shadow: SignInRouterShadow;
  hooks: BetterAuthHookCollaborators;
  ssoIssuers: BetterAuthSsoIssuers;
  credentialGuard: CredentialSessionGuard;
  signInLockout: SignInAttemptCounter;
  addressRoutesToConnection: AddressRoutesToConnection;
}): BetterAuthOptions & {
  // `emailAndPassword` is optional on `BetterAuthOptions` but this factory
  // always states it, and `enabled` inside it is REQUIRED. Saying so keeps the
  // spread below from degrading the credentials gate to "unset", which
  // better-auth would then have to guess at.
  emailAndPassword: NonNullable<BetterAuthOptions["emailAndPassword"]>;
} => ({
  baseURL: deployment.baseUrl,
  /**
   * Our own address, plus the providers our customers registered. A FUNCTION
   * because the answer is not fixed at boot, and only single sign-on requests
   * pay for the read. See `rules/trusted-origins.rules.ts`.
   */
  trustedOrigins: async (request) =>
    resolveTrustedOrigins({
      baseUrl: deployment.baseUrl,
      publicBaseUrl: deployment.publicBaseUrl,
      trustedIdpOrigins: deployment.trustedIdpOrigins,
      idpSimulatorUrl: deployment.idpSimulatorUrl,
      registeredIssuers: await ssoIssuers.issuersForRequest(request),
      isProduction: deployment.isProduction,
    }),
  secret: deployment.secret,
  /**
   * The identity storage adapter (ADR-116 §1) — one `database:` entry,
   * forever.
   */
  database: storage.adapter() as NonNullable<BetterAuthOptions["database"]>,

  /**
   * Tell BetterAuth's rate limiter (and session IP tracking) which headers carry the real
   * client IP.
   */
  advanced: {
    ipAddress: {
      ipAddressHeaders: ["cf-connecting-ip", "x-forwarded-for", "x-real-ip"],
    },
  },

  /**
   * Route OAuth callback errors to our Next.js `/auth/error` page (which handles the
   * friendly messages for `DIFFERENT_EMAIL_NOT_ALLOWED`, `SSO_PROVIDER_NOT_ALLOWED`,
   * `OAuthAccountNotLinked`, etc.).
   */
  onAPIError: {
    errorURL: `${deployment.baseUrl}/auth/error`,
  },

  // Map BetterAuth's expected models to the existing capitalized Prisma tables.
  // Field mappings translate BetterAuth's canonical names to the legacy
  // snake_case / NextAuth column names we keep in place — no column renames.
  user: {
    modelName: "User",
    additionalFields: {
      pendingSsoSetup: { type: "boolean", defaultValue: false, input: false },
      deactivatedAt: { type: "date", required: false, input: false },
      lastLoginAt: { type: "date", required: false, input: false },
    },
  },
  session: {
    modelName: "Session",
    fields: {
      token: "sessionToken",
      expiresAt: "expires",
    },
    additionalFields: {
      impersonating: { type: "string", required: false, input: false },
    },
    // Preserve NextAuth's 30-day session TTL. BetterAuth defaults to 7 days,
    // which would force users to re-auth more often than before. Match the
    // old NextAuth `maxAge: 30 * 24 * 60 * 60` value for parity.
    expiresIn: 30 * 24 * 60 * 60,
    // Refresh the session expiry on use but not on every request — the old
    // NextAuth behavior was "rolling, but not thrashing the DB".
    updateAge: 24 * 60 * 60,
    /**
     * REQUIRED when `secondaryStorage` is set. Without this, BetterAuth's `createSession`
     * skips the main adapter (Prisma) and only writes to Redis.
     */
    storeSessionInDatabase: true,
  },
  account: {
    modelName: "Account",
    fields: {
      accountId: "providerAccountId",
      providerId: "provider",
      accessToken: "access_token",
      refreshToken: "refresh_token",
      accessTokenExpiresAt: "expires_at",
      idToken: "id_token",
      scope: "scope",
    },
    /**
     * Allow an OAuth sign-in to link to an existing User row when the email matches AND that
     * User's `emailVerified` is true.
     */
    accountLinking: {
      enabled: true,
    },
  },
  verification: {
    modelName: "VerificationToken",
    // SAML replay reservations are primary-key inserts: with Redis as secondary
    // storage they must still reach Postgres, so a replayed assertion is refused.
    storeInDatabase: true,
    fields: {
      identifier: "identifier",
      value: "token",
      expiresAt: "expires",
    },
  },

  /**
   * Credentials signin/signup is ONLY enabled in on-prem `email` mode.
   * ADR-027: on self-hosted (`!IS_SAAS`) the routes are always MOUNTED —
   */
  emailAndPassword: {
    enabled: deployment.emailPasswordEnabled,
    password: {
      hash: async (password: string) => hash(password, 10),
      verify: async ({ password, hash: storedHash }) => compare(password, storedHash),
    },
    /**
     * Reset-link lifetime. Kept at BetterAuth's one-hour default but stated
     * explicitly so the email copy ("this link expires in 1 hour") and the
     * token expiry can't silently drift apart.
     */
    resetPasswordTokenExpiresIn: 60 * 60,
    /**
     * Password reset wired to transactional mailer. Deliberately reachable on
     * denied SSO deployments for recovery (ADR-027); after reset, force-logout all sessions.
     */
  },

  /**
   * Rate limiting to mitigate credential stuffing / brute force on signin. Defaults apply to
   * every /api/auth/* path; customRules tighten the credentials signin path specifically.
   */
  rateLimit: {
    enabled: true,
    window: 60,
    max: 100,
    storage: "memory",
    customRules: {
      "/sign-in/email": { window: 60 * 15, max: 30 },
      "/sign-up/email": { window: 60 * 60, max: 50 },
      "/sign-in/social": { window: 60 * 15, max: 50 },
      // BetterAuth's password reset endpoints are `request-password-reset` and `reset-password`.
      // The NextAuth-era rule named `/forget-password` didn't match anything under BetterAuth —
      // we ported it literally during the migration without checking the new endpoint names.
      "/request-password-reset": { window: 60 * 60, max: 5 },
      "/reset-password": { window: 60 * 60, max: 5 },
      // Passkey sign-up drops the session requirement from these two, so they are an
      // unauthenticated way to create an account and are limited as one — alongside
      // `/sign-up/email`, which is the same thing by another door. Options are generated once
      // per attempt and verification runs only after a system prompt, so a person doing this by
      // hand never approaches either number.
      "/passkey/generate-register-options": { window: 60 * 60, max: 50 },
      "/passkey/verify-registration": { window: 60 * 60, max: 50 },
    },
  },

  secondaryStorage: undefined,
  socialProviders: deployment.socialProviders,
  plugins: genericOAuthPlugins(deployment),

  databaseHooks: {
    user: {
      create: {
        before: beforeUserCreate,
        after: async (user) => {
          await afterUserCreate({
            repo,
            user: {
              id: user.id,
              email: user.email,
              name: user.name,
              emailVerified: user.emailVerified,
            },
            collaborators: hooks,
          });
        },
      },
      delete: {
        /**
         * ADR-101 §2: a user delete is an ERASURE, and erasure is what wipes
         * `Identifier.value` and `identifierHash`. Before the row goes, so a refused ceremony
         * refuses the delete with it; a no-op for users whose backfill has not latched.
         */
        before: async (user) => {
          await identity.beforeUserDelete(user as { id: string });
        },
      },
    },
    account: {
      create: {
        before: async (account, context) => {
          await createBeforeAccountCreateHook({ repo, federation })(account, context);
          // ADR-101 §2: the account row is an identifier attach. Returning
          // the row data pins its id, which is what makes the live identifier id and the backfill's
          // derived id the same id.
          // The BRIDGE ceremonies, not the bare ones (ADR-116 §5): the
          const pin = await identity.createAccountIdentifier(account);
          return pin.pinned ? { data: pin.data } : undefined;
        },
        after: async (account) => {
          if (!account.userId || !account.providerId || !account.accountId) return;
          await afterAccountCreate({
            repo,
            account: {
              userId: account.userId as string,
              providerId: account.providerId as string,
              accountId: account.accountId as string,
            },
            collaborators: hooks,
          });
        },
      },
      update: {
        after: async (account) => {
          // BetterAuth refreshes tokens on the linked Account row on every
          // OAuth sign-in. Use that as the trigger to reconcile pendingSsoSetup
          // for users whose correct-provider account is already linked.
          if (!account.userId || !account.providerId || !account.accountId) return;
          await afterAccountUpdate({
            repo,
            account: {
              userId: account.userId as string,
              providerId: account.providerId as string,
              accountId: account.accountId as string,
            },
            collaborators: hooks,
          });
        },
      },
      delete: {
        /** ADR-101 §2: an account row removed is an identifier detach — and
         *  the adapter's own, for anyone it routes to the identity branch. */
        before: async (account) => {
          await identity.beforeAccountDelete(account);
        },
      },
    },
    verification: {
      create: {
        // The ceremony companion a second factor is checked against, written
        // beside better-auth's own 2FA challenge (sso-credential-enforcement).
        before: async (verification, context) => {
          await credentialGuard.beforeVerificationCreate({
            verification: { ...verification, expiresAt: fromDate(verification.expiresAt) },
            context,
          });
          return undefined;
        },
      },
    },
    session: {
      create: {
        before: async (session, context) => {
          await credentialGuard.beforeSessionCreate({ userId: session.userId, context });
          return createBeforeSessionCreateHook({ repo, collaborators: hooks })(session, context);
        },
        after: async (session) => {
          await afterSessionCreate({
            repo,
            userId: session.userId,
            announcements: hooks.announcements,
          });
        },
      },
    },
  },

  // BetterAuth logger wiring
  logger: {
    disabled: false,
    log: (level, message, ...args) => {
      if (level === "error") {
        logger.error({ args }, message);
      } else if (level === "warn") {
        logger.warn({ args }, message);
      } else {
        logger.info({ args }, message);
      }
    },
  },

  /**
   * BetterAuth mounts credential endpoints even when email/password is off.
   * In SSO mode, ADR-027 uses this same memoized gate: allow blocks email
   */
  hooks: {
    before: createBeforeRequestHook({
      federation,
      shadow,
      signInLockout,
      addressRoutesToConnection,
    }),
    /** `createAuthMiddleware` is load-bearing, not ceremony: the after-hook
     *  runner reads `.headers` off whatever the hook returns, unguarded, so a
     *  bare async resolving undefined fails EVERY auth request after its
     *  endpoint has already answered. */
    after: createAuthMiddleware(async (ctx) => {
      await countSignInAttempt({ ctx, signInLockout });
      answerAuthRefusalByRegisteredCode(ctx);
    }),
  },
});

/**
 * Two-step verification as main mounts it: an account holding no password (a
 * passkey sign-up) sets it up without one, and backup codes are stored encrypted.
 */
export function twoFactorPlugin(): ReturnType<typeof twoFactor> {
  return twoFactor({
    issuer: "LangWatch",
    allowPasswordless: true,
    backupCodeOptions: { storeBackupCodes: "encrypted" },
  });
}

/**
 * The generic-OIDC plugin, mounted only when this deployment configured a connection for
 * it.
 */
function genericOAuthPlugins(
  deployment: BetterAuthDeploymentConfiguration,
): NonNullable<BetterAuthOptions["plugins"]> {
  if (deployment.genericOAuthConfigs.length === 0) return [];
  return [genericOAuth({ config: [...deployment.genericOAuthConfigs] })];
}

/**
 * The single sign-on plugin: `/sign-in/sso` and the callbacks a customer's
 * own identity provider answers. Mounted always, because a connection is
 * refused per organization by the gate below and never by an absent route.
 */
function ssoPlugin(assertions: SsoAssertionApi): ReturnType<typeof sso> {
  return sso({
    /**
     * Provider rows are a projection of the managed connection log, so the
     * plugin's own session-authenticated registration route must never become
     * a second writer for the same configuration.
     */
    providersLimit: 0,
    /**
     * The provider's word on whether it verified the address, which is what
     * lets an organization move without minting a second account for
     * everybody. Warranted only because `resolveUser` asks the proved domain.
     */
    trustEmailVerified: true,
    /** Somebody with no account who signs in through their employer's
     *  provider gets one; where they land is the arrival policy's business. */
    disableImplicitSignUp: false,
    resolveUser: async (input) => resolveSsoUser({ assertions, input }),
  });
}

/**
 * Whether this verified assertion may become a session at all — asked before
 * anything links it to a person, because deciding membership first was an
 * account takeover (ADR-117 §5).
 */
export async function resolveSsoUser({
  assertions,
  input,
}: {
  assertions: SsoAssertionApi;
  input: SSOUserResolutionInput;
}): Promise<SSOUserResolution> {
  try {
    const decision = await assertions.decide({
      providerId: input.providerId,
      accountId: input.accountKey.accountId,
      email: input.providerUser.email,
    });
    if (decision.action === "continue") return { action: "continue" };

    /** RETURNED, NEVER THROWN: the plugin catches and answers
     *  `SSO_USER_RESOLUTION_FAILED`, destroying a thrown handled error.
     *  Returned, the code reaches the screen that renders its copy. */
    return { action: "reject", code: decision.error.code };
  } catch (error) {
    /** We log our own failure because nobody else will: the plugin discards
     *  this error and answers `SSO_USER_RESOLUTION_FAILED` to the customer. */
    logger.error(
      { error, providerId: input.providerId, email: input.providerUser.email },
      "deciding whether a single sign-on account may be linked threw; the plugin will answer SSO_USER_RESOLUTION_FAILED and discard this error",
    );
    throw error;
  }
}

/**
 * The issuers ONE request may reach. Asked per request rather than resolved
 * at boot: a connection registered a minute ago has to be dialable now.
 */
export interface BetterAuthSsoIssuers {
  issuersForRequest(request: Request | undefined): Promise<string[]>;
}

/**
 * Everything the deployment's one Better Auth instance is built from.
 */
export type BetterAuthTransportOptions = Readonly<{
  /** The Auth service whose sessions this instance mints and revokes. */
  auth: AuthApi;
  /** The persistence boundary every database hook reads and writes through. */
  database: BetterAuthHooksRepository;
  /** The instance's storage engine — see {@link BetterAuthStorage}. */
  storage: BetterAuthStorage;
  deployment: BetterAuthDeploymentConfiguration;
  federation: BetterAuthFederation;
  identity: BetterAuthIdentityCeremonies;
  invites: BetterAuthPendingInvite;
  announcements: BetterAuthAnnouncements;
  shadow: SignInRouterShadow;
  /** The grant ledger an SSO auto-join writes its membership through. */
  authzGrants: BetterAuthHookCollaborators["authzGrants"];
  /** The connection's arrival door every federated sign-in is asked of. */
  arrivals: BetterAuthHookCollaborators["arrivals"];
  /** Whether a customer's identity provider may assert this address at all. */
  ssoAssertions: SsoAssertionApi;
  /** Whose registered issuers this request is allowed to reach. */
  ssoIssuers: BetterAuthSsoIssuers;
  /** Where a sign-in through a connection is recorded as having happened. */
  ssoActivity: BetterAuthHookCollaborators["ssoActivity"];
  /** Which of a cutover's two connections a callback belongs to. */
  ssoMigration: BetterAuthHookCollaborators["ssoMigration"];
  /**
   * Sends the password-reset link.
   */
  sendResetPassword: (input: { email: string; token: string }) => Promise<void>;
  secondaryStorage: NonNullable<BetterAuthOptions["secondaryStorage"]>;
  /** Presence decides whether Better Auth's rate limiter uses secondary storage. */
  redis: RedisConnection | null;
  signUpVerification: SignUpVerification;
  users: UserApi;
  /** Whether an already proved password may open this deployment's local door
   *  for the organization its address routes to. */
  credentialGuard: CredentialSessionGuard;
  /** The consecutive-failure counter behind account lock-out (GAC-09). */
  signInLockout: SignInAttemptCounter;
  /** Whether an organization's own connection governs an address (D04). */
  addressRoutesToConnection: AddressRoutesToConnection;
}>;

/**
 * Builds the deployment's ONE Better Auth instance.
 */
export const createBetterAuthTransport = ({
  announcements,
  arrivals,
  auth,
  authzGrants,
  credentialGuard,
  database,
  deployment,
  federation,
  identity,
  invites,
  redis,
  secondaryStorage,
  sendResetPassword,
  shadow,
  signUpVerification,
  ssoActivity,
  ssoAssertions,
  ssoIssuers,
  signInLockout,
  addressRoutesToConnection,
  ssoMigration,
  storage,
  users,
}: BetterAuthTransportOptions) => {
  const authOptions = createAuthOptions({
    repo: database,
    deployment,
    storage,
    federation,
    identity,
    shadow,
    ssoIssuers,
    credentialGuard,
    signInLockout,
    addressRoutesToConnection,
    hooks: {
      federation,
      invites,
      announcements,
      authzGrants,
      arrivals,
      ssoActivity,
      ssoMigration,
    },
  });
  return betterAuth({
    ...authOptions,
    plugins: [
      ...genericOAuthPlugins(deployment),
      ...(deployment.mfaEnrollmentOpen ? [twoFactorPlugin()] : []),
      ...(deployment.passkeysEnabled
        ? [
            passkey({
              registration: passkeySignUpRegistration({
                announcements,
                handleSecret: deployment.passkeyHandleSecret,
                users,
                verification: signUpVerification,
              }),
            }),
          ]
        : []),
      ssoPlugin(ssoAssertions),
    ],
    secondaryStorage,
    rateLimit: {
      ...authOptions.rateLimit,
      storage: redis ? "secondary-storage" : "memory",
    },
    emailAndPassword: {
      ...authOptions.emailAndPassword,
      sendResetPassword: async ({ user, token }) => {
        await sendResetPassword({ email: user.email, token });
      },
      onPasswordReset: async ({ user }) => {
        await auth.revokeAllBrowserSessions({ userId: user.id });
      },
    },
  });
};

export type BetterAuthTransport = ReturnType<typeof createBetterAuthTransport>;
