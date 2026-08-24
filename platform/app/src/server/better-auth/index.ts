import {
  buildGenericOAuthConfigs,
  buildSocialProviders,
} from "@ee/sso/providers";
import {
  isCredentialMutationPath,
  isEmailAuthPath,
  isGateDependentPath,
  isGatedSsoPath,
  isPasswordResetPath,
  normalizedRequestPathname,
  requestPathname,
} from "@ee/sso/ssoPathGate";
import type { SignInMethodPolicy } from "@langwatch/identity";
import { createLogger } from "@langwatch/observability";
import { RedisConfigService } from "@langwatch/redis-client";
import { compare, hash } from "bcrypt";
import { type BetterAuthOptions, betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { APIError } from "better-auth/api";
import { genericOAuth } from "better-auth/plugins/generic-oauth";
import { twoFactor } from "better-auth/plugins/two-factor";
import { passkey } from "@better-auth/passkey";
import { env } from "~/env.mjs";
import { tryGetApp } from "~/server/app-layer/app";
import { identityCeremonies } from "~/server/app-layer/identity/runtime";
import {
  deploymentIsFederationCapable,
  resolveSignInMethodPolicy,
} from "~/server/app-layer/identity/signin-method-policy";
import { prisma } from "~/server/db";
import { fireActivityTrackingNurturing } from "../../../ee/billing/nurturing/hooks/activityTracking";
import { ensureUserSyncedToCio } from "../../../ee/billing/nurturing/hooks/userSync";
import { sendResetPasswordEmail } from "../mailer/resetPasswordEmail";
import {
  afterAccountCreate,
  afterAccountUpdate,
  afterSessionCreate,
  afterUserCreate,
  beforeAccountCreate,
  beforeSessionCreate,
  beforeUserCreate,
} from "./hooks";
import { revokeAllSessionsForUser } from "./revokeSessions";
import { runSignInRouterShadow } from "./signInRouterShadow";

const logger = createLogger("langwatch:better-auth");

/**
 * Whether BetterAuth's email/password (credentials) routes are MOUNTED.
 *
 * On SaaS they mount only in native `email` mode: the original NextAuth code
 * mounted EITHER a social provider OR CredentialsProvider, never both, so
 * users could not bypass the configured SSO. This gate mirrors that invariant.
 *
 * On self-hosted they always mount, even with an enterprise IdP configured,
 * so that a deployment the SSO license gate DENIES has a working coerced email
 * door and a licensed install keeps password-reset self-recovery reachable
 * (ADR-027). Mounting is not the gate: the `before` hook below is what blocks
 * `/sign-in/email` and `/sign-up/email` when the gate ALLOWS, which is the
 * load-bearing guard against minting password accounts on a licensed install.
 *
 * Exported for unit testing — lets us assert the credentials gate per provider
 * without re-initializing the module under a different `NEXTAUTH_PROVIDER`.
 */
export const isEmailPasswordEnabled = (
  e: Pick<typeof env, "NEXTAUTH_PROVIDER" | "IS_SAAS">,
): boolean => e.NEXTAUTH_PROVIDER === "email" || !e.IS_SAAS;

const socialProviders = buildSocialProviders(env);
const genericOAuthConfigs = buildGenericOAuthConfigs(env);

// NOTE: BetterAuth's admin plugin is intentionally NOT used. It expects
// `User.role` and `User.banned` columns which our schema doesn't have, and
// it would override admin impersonation with its own mechanism. We use our
// own `isAdmin` check (ee/admin/isAdmin.ts) and the legacy
// Session.impersonating JSON column handled in src/server/auth.ts.
/**
 * D06 / D07. Both flags are read at module load, because that is when
 * `betterAuth()` below is constructed and a plugin decides which ROUTES
 * exist. With a flag off the plugin is not registered at all, so its routes
 * are not mounted and nothing about the feature is reachable — which is what
 * makes "with the flag off nothing about it exists" true of the surface
 * rather than merely of the screens.
 *
 * Turning a flag back off is not a deletion. `TwoFactor` and `Passkey` rows
 * survive it and nobody is signed out; the feature stops being ASKED for,
 * and turning it on again finds everything where it was.
 *
 * Env rather than a feature flag for both: a challenge stands between a
 * password and a session, and registering a passkey happens on the sign-in
 * screen. Feature flags are read per project, and neither caller has one yet.
 */
const mfaEnrollmentOpen = env.MFA_ENROLLMENT_OPEN === "on";
const passkeysEnabled = env.PASSKEYS_ENABLED === "on";

const plugins = [
  ...(genericOAuthConfigs.length > 0
    ? [genericOAuth({ config: genericOAuthConfigs })]
    : []),
  ...(mfaEnrollmentOpen
    ? [
        twoFactor({
          issuer: "LangWatch",
          // Encrypted, not hashed. A backup code has to be COMPARED against
          // what the person types, and the plugin's own verification path
          // decrypts and compares; hashing them would make the plugin
          // unable to verify its own codes. `NEXTAUTH_SECRET` is the key,
          // which is why turning the flag on without one set is refused at
          // boot by the env schema rather than at first use.
          backupCodeOptions: { storeBackupCodes: "encrypted" },
        }),
      ]
    : []),
  ...(passkeysEnabled
    ? [
        passkey({
          rpName: "LangWatch",
          // The relying party is the app's own origin. Left to the plugin's
          // default derivation from `baseURL` so a self-hosted install on
          // its own hostname works without a second place to configure it.
        }),
      ]
    : []),
];

/**
 * Wire BetterAuth's secondary storage to the App's Redis connection. Used by
 * rate limiting (below) so limits are enforced across pods.
 *
 * WHETHER to configure it is decided here, at module load, because
 * `betterAuth()` below is itself constructed at module load and the choice
 * changes its session strategy — a deployment with no Redis must get `undefined`
 * and keep its sessions in the database. That decision is a pure question about
 * *configuration*, so it is answered from env rather than from a live client
 * (ADR-093); the client itself is resolved lazily, inside each callback.
 *
 * `BUILD_TIME` joins `SKIP_REDIS` in the skip signal: a build or a test run has
 * env pointing at a Redis it must not adopt as a session store.
 */
const redisEnv = {
  url: env.REDIS_URL,
  clusterEndpoints: env.REDIS_CLUSTER_ENDPOINTS,
  skip: env.SKIP_REDIS || !!process.env.BUILD_TIME,
};

/**
 * The App's connection at the moment a storage callback runs.
 *
 * Null wherever env advertises Redis but the App has none, which is three
 * states, not one: a test app, a callback firing before boot completes, and —
 * for the whole life of the process — anything that never builds an App at all
 * (a task, a bare `tsx scripts/*.ts`). `start.ts` boots before it listens, so
 * the web entrypoint only ever sees the first two.
 *
 * Resolving per call rather than once at import is what makes this possible,
 * and it is deliberate: the alternative needs a live client at module load.
 * See the ADR's note on where the old singleton's behaviour is and is not
 * reproduced.
 */
const secondaryStorageConnection = () => tryGetApp()?.redis ?? null;

/**
 * How many writes this process has dropped for want of a connection.
 *
 * Carried in the log line because the *first* drop and the ten-thousandth mean
 * different things: one is a request that raced boot, a climbing count is a
 * process serving auth with no secondary storage at all.
 */
let droppedSecondaryWrites = 0;

/**
 * Reports a write that went nowhere.
 *
 * A dropped read is a cache miss and better-auth recovers it from the database.
 * A dropped WRITE has no such recovery, and one of its tenants is the
 * credential sign-in rate-limit counter, which lives only in secondary storage:
 * dropping the `set` is a rate limit that fails OPEN. That is a security-
 * relevant degradation, so it does not get to be silent (#6950).
 *
 * The key is deliberately not logged. Better-auth keys secondary storage by
 * session token, so the key IS a credential.
 */
const reportDroppedSecondaryWrite = (operation: "set" | "delete"): void => {
  droppedSecondaryWrites += 1;
  logger.warn(
    { operation, droppedSecondaryWrites },
    "better-auth secondary storage write dropped: Redis is configured but the application has no connection. Rate limiting and session revocation degrade to fail-open until it does.",
  );
};

/**
 * The storage better-auth is configured with — `undefined` when this deployment
 * has no Redis, in which case sessions stay in the database.
 *
 * Exported for unit testing, the same way `isEmailPasswordEnabled` is: ADR-093
 * moved this from "decided once against a live singleton" to "resolved per
 * call", which opened a window where the callbacks run with no connection.
 * That window is the contract now, so it is asserted rather than merely
 * commented (#6950).
 */
export const secondaryStorage: BetterAuthOptions["secondaryStorage"] =
  new RedisConfigService().isConfigured(redisEnv)
    ? {
        get: async (key) => {
          const redis = secondaryStorageConnection();
          // A miss, not a failure: better-auth falls through to the database.
          if (!redis) return null;
          return await redis.get(`better-auth:${key}`);
        },
        set: async (key, value, ttl) => {
          const redis = secondaryStorageConnection();
          if (!redis) return reportDroppedSecondaryWrite("set");
          if (ttl) {
            await redis.set(`better-auth:${key}`, value, "EX", ttl);
          } else {
            await redis.set(`better-auth:${key}`, value);
          }
        },
        delete: async (key) => {
          const redis = secondaryStorageConnection();
          if (!redis) return reportDroppedSecondaryWrite("delete");
          await redis.del(`better-auth:${key}`);
        },
      }
    : undefined;

const isBuildTime = !!process.env.BUILD_TIME;

/**
 * Whether a licensed deployment should refuse this credential route, the
 * ADR-027 gate site #3 decision.
 *
 * Two conditions, and the second is the one that is easy to leave out. The
 * route has to be one that mints or recovers a password account, and this
 * deployment has to actually federate — a stronger claim than the license gate
 * allowing it. The resolved method policy carries no federated method when
 * NEXTAUTH_PROVIDER names a provider this build cannot mount, and the sign-in
 * page renders the credential form on exactly that answer. Refusing the form
 * the page just offered would tell a licensed operator their account is
 * managed by an identity provider that does not exist, and leave them no way
 * in at all.
 *
 * ADR-117 §4 is what changed here, and only in mechanism: the question used to
 * be asked of `resolveAuthProvider()` directly and is now asked of the method
 * policy that resolver feeds. Same answer, one source.
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

  return policy.defaultMethods.some((method) => method.kind === "federated");
}

export const auth = betterAuth({
  baseURL: isBuildTime ? "http://localhost" : env.NEXTAUTH_URL,
  trustedOrigins: isBuildTime
    ? []
    : [
        env.NEXTAUTH_URL,
        // Behind a reverse proxy (Boxd forks, preview deploys, tunneling
        // services), BASE_HOST is the external URL while NEXTAUTH_URL may
        // be the internal one. Accept both so sign-in/sign-up don't fail
        // with "Invalid origin".
        ...(env.BASE_HOST && env.BASE_HOST !== env.NEXTAUTH_URL
          ? [env.BASE_HOST]
          : []),
      ],
  secret: isBuildTime ? "build-time-only" : env.NEXTAUTH_SECRET,
  /**
   * The stock adapter — ADR-116's bridge phase. `Account` is a PROJECTION
   * of the identity event log: better-auth reads and writes it exactly as
   * it always has, and the fold maintains its linkage columns. Wrapping
   * this adapter can never intercept a model — the factory's own traffic
   * (its join emulation, its transactions) runs below a wrapper — which is
   * why ADR-116's identity storage adapter takes over AT the factory in
   * its later phases, not in front of this one.
   */
  database: prismaAdapter(prisma, { provider: "postgresql" }),

  /**
   * Tell BetterAuth's rate limiter (and session IP tracking) which
   * headers carry the real client IP. The default is `["x-forwarded-for"]`
   * which works for most proxies, but behind Cloudflare the definitive
   * header is `cf-connecting-ip` — it's always a single IP set by
   * Cloudflare itself, not a forwarding chain. We list both so the
   * setup works with and without Cloudflare. The order matters:
   * BetterAuth takes the first header that has a valid IP.
   */
  advanced: {
    ipAddress: {
      ipAddressHeaders: ["cf-connecting-ip", "x-forwarded-for", "x-real-ip"],
    },
  },

  /**
   * Route OAuth callback errors to our Next.js `/auth/error` page (which
   * handles the friendly messages for `DIFFERENT_EMAIL_NOT_ALLOWED`,
   * `SSO_PROVIDER_NOT_ALLOWED`, `OAuthAccountNotLinked`, etc.). Without
   * this, BetterAuth's default is `${baseURL}/api/auth/error` which serves
   * its built-in HTML error page and bypasses our UI. The relative path is
   * intentional — `c.redirect` honors it at the response level.
   */
  onAPIError: {
    errorURL: `${env.NEXTAUTH_URL}/auth/error`,
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
     * REQUIRED when `secondaryStorage` is set. Without this, BetterAuth's
     * `createSession` skips the main adapter (Prisma) and only writes to
     * Redis. That breaks our admin impersonation flow, which lives in the
     * legacy `Session.impersonating` JSON column — `getServerAuthSession`
     * does `prisma.session.findUnique({where: {id: ...}})` to read it, and
     * `/api/admin/impersonate` does `prisma.session.update` to write it.
     * Both crash with "Record not found" when the row only exists in Redis.
     * Forcing dual-write keeps Redis useful (rate limiting, secondary
     * storage for plugins) while preserving DB-backed impersonation.
     *
     * D06 gives this a second, independent reason that outlives the first.
     * A session now records WHICH sign-in method minted it and WHAT that
     * sign-in proved (`Session.identifierId`, `Session.amr`), and an
     * organization's two-step requirement reads that when a member reaches
     * its data. A session row that existed only in Redis could not carry
     * either column, so the requirement would read null for everybody and
     * hold every federated member at a gate they cannot pass. Even when
     * impersonation eventually stops using `Session.impersonating`, this
     * option stays required.
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
     * Allow an OAuth sign-in to link to an existing User row when the email
     * matches AND that User's `emailVerified` is true. Without this, an
     * orphan User (no `Account` rows — e.g. pre-seeded invite, half-finished
     * legacy signup, or migration leftover) blocks every subsequent OAuth
     * sign-in for that email with `account_already_linked_to_different_user`
     * → surfaced to the UI as "registered with another authentication method".
     *
     * On SSO-enforced orgs this was especially broken: even though the user
     * authenticated successfully through the org's IdP, BetterAuth refused to
     * attach the new Account, leaving them permanently locked out.
     *
     * Security posture: linking requires the existing User to be
     * `emailVerified=true` and the OAuth provider to return the same email
     * (`allowDifferentEmails` defaults to false). SSO-domain enforcement
     * still runs in `beforeAccountCreate` and rejects the wrong provider
     * before any link happens.
     */
    accountLinking: {
      enabled: true,
    },
  },
  verification: {
    modelName: "VerificationToken",
    fields: {
      identifier: "identifier",
      value: "token",
      expiresAt: "expires",
    },
  },

  /**
   * Credentials signin/signup is ONLY enabled in on-prem `email` mode.
   * In cloud / SSO deployments (NEXTAUTH_PROVIDER=auth0/google/github/...)
   * the original NextAuth code added EITHER a social provider OR
   * CredentialsProvider — never both — so users could not bypass the
   * configured SSO. BetterAuth defaults to mounting the email/password
   * routes (`/sign-up/email`, `/sign-in/email`) whenever
   * `emailAndPassword.enabled` is set, so we have to mirror the gate
   * here. Without it, an attacker could POST to `/api/auth/sign-up/email`
   * in cloud mode and bypass Auth0/SSO entirely.
   *
   * ADR-027: on self-hosted (`!IS_SAAS`) the routes are always MOUNTED —
   * even when an enterprise IdP is configured — so a denied (unlicensed)
   * deployment has a working coerced email door and licensed installs keep
   * password-reset self-recovery reachable. Mounting alone is NOT the
   * gate: the `before` hook below (gate site #3) is what blocks
   * `/sign-in/email` + `/sign-up/email` when the SSO license gate ALLOWS —
   * that's the load-bearing guard against minting password accounts on a
   * licensed Auth0/Okta install (v5 BLOCKER fix). SaaS is unchanged: routes
   * stay unmounted unless natively in email mode.
   */
  emailAndPassword: {
    enabled: isEmailPasswordEnabled(env),
    password: {
      hash: async (password: string) => hash(password, 10),
      verify: async ({ password, hash: storedHash }) =>
        compare(password, storedHash),
    },
    /**
     * Reset-link lifetime. Kept at BetterAuth's one-hour default but stated
     * explicitly so the email copy ("this link expires in 1 hour") and the
     * token expiry can't silently drift apart.
     */
    resetPasswordTokenExpiresIn: 60 * 60,
    /**
     * Wires BetterAuth's /request-password-reset endpoint to our existing
     * transactional mailer (SendGrid / SES via `sendEmail`). Without this the
     * endpoint returns RESET_PASSWORD_DISABLED. We ignore BetterAuth's default
     * `url` and build the link off BASE_HOST + the issued token so it lands on
     * our own /auth/reset-password page. Reset is deliberately reachable on a
     * deployment the SSO license gate denies, even with an IdP configured
     * (ADR-027), so that a user whose account was born through that IdP can
     * still recover through their inbox. It closes again once the gate allows.
     */
    sendResetPassword: async ({ user, token }) => {
      await sendResetPasswordEmail({
        email: user.email,
        resetUrl: `${env.BASE_HOST}/auth/reset-password?token=${encodeURIComponent(token)}`,
      });
    },
    /**
     * After a successful reset, force-logout every existing session for the
     * user. The self-service change-password flow revokes *other* sessions
     * (keeping the current tab); here the user isn't signed in, and a reset is
     * the recovery path for a possibly-compromised account, so we revoke all.
     */
    onPasswordReset: async ({ user }) => {
      await revokeAllSessionsForUser({ prisma, userId: user.id });
    },
  },

  /**
   * Rate limiting to mitigate credential stuffing / brute force on signin.
   * Defaults apply to every /api/auth/* path; customRules tighten the
   * credentials signin path specifically. Uses Redis secondaryStorage for
   * distributed rate limiting when available, falls back to in-memory.
   */
  rateLimit: {
    enabled: true,
    window: 60,
    max: 100,
    storage: secondaryStorage ? "secondary-storage" : "memory",
    customRules: {
      "/sign-in/email": { window: 60 * 15, max: 30 },
      "/sign-up/email": { window: 60 * 60, max: 50 },
      "/sign-in/social": { window: 60 * 15, max: 50 },
      // BetterAuth's password reset endpoints are `request-password-reset`
      // and `reset-password`. The NextAuth-era rule named `/forget-password`
      // didn't match anything under BetterAuth — we ported it literally
      // during the migration without checking the new endpoint names. Fix
      // (iter 47 / bug 32): use the actual endpoint paths so the
      // 5-per-hour cap is enforced even though
      // `emailAndPassword.sendResetPassword` isn't configured (the endpoint
      // still returns 400 RESET_PASSWORD_DISABLED, but the rate limit
      // prevents using that response as an enumeration side-channel).
      "/request-password-reset": { window: 60 * 60, max: 5 },
      "/reset-password": { window: 60 * 60, max: 5 },
    },
  },

  secondaryStorage,
  socialProviders,
  plugins,

  databaseHooks: {
    user: {
      create: {
        before: async (user) =>
          beforeUserCreate({
            prisma,
            user: user as {
              email: string;
              deactivatedAt?: Date | null;
            } & Record<string, unknown>,
          }),
        after: async (user) => {
          await afterUserCreate({
            prisma,
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
          await identityCeremonies().beforeUserDelete(user);
        },
      },
    },
    account: {
      create: {
        before: async (account) => {
          await beforeAccountCreate({
            prisma,
            account: {
              userId: account.userId,
              providerId: account.providerId,
              accountId: account.accountId,
            },
          });
          // ADR-101 §2: the account row is an identifier attach. Returning
          // the row data pins its id, which is what makes the live
          // identifier id and the backfill's derived id the same id.
          return identityCeremonies().beforeAccountCreate(account);
        },
        after: async (account) => {
          if (!account.userId || !account.providerId || !account.accountId)
            return;
          await afterAccountCreate({
            prisma,
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
          await afterAccountUpdate({
            prisma,
            account: {
              userId: account.userId as string,
              providerId: account.providerId as string,
              accountId: account.accountId as string,
            },
          });
        },
      },
      delete: {
        /** ADR-101 §2: an account row removed is an identifier detach. */
        before: async (account) => {
          await identityCeremonies().beforeAccountDelete(account);
        },
      },
    },
    session: {
      create: {
        before: async (session) =>
          beforeSessionCreate({
            prisma,
            session: { userId: session.userId },
          }),
        after: async (session) => {
          await afterSessionCreate({
            prisma,
            userId: session.userId,
            fireActivityTrackingNurturing,
            ensureUserSyncedToCio,
          });
        },
      },
    },
  },

  // BetterAuth logger wiring
  logger: {
    disabled: false,
    log: (level, message, ...args) => {
      (logger as any)[level]?.({ args }, message);
    },
  },

  /**
   * Global before-hook that blocks credential-management endpoints in
   * cloud/SSO mode. BetterAuth mounts these endpoints unconditionally
   * (only `/sign-in/email` and `/sign-up/email` check the
   * `emailAndPassword.enabled` flag). In cloud mode we don't want a
   * user with a legacy credential Account row (e.g. from a prior
   * on-prem deployment) to be able to bypass our tRPC `changePassword`
   * mutation — which gates on `env.NEXTAUTH_PROVIDER === "email"` AND
   * calls `revokeOtherSessionsForUser` (iter 26) — by POSTing directly
   * to BetterAuth's endpoint. In pure cloud deployments this has zero
   * user impact (no credential accounts exist), but in mixed/migration
   * scenarios it prevents a subtle side-channel around the tRPC gate.
   *
   * Also blocks `/set-password` (BetterAuth's flow for first-time
   * password setup on a social-signup user — not something we want
   * available in cloud mode where SSO is the only path).
   *
   * ADR-027 extends this SAME hook (one memoized gate value, branched both
   * ways — no truth table, Decision 4) for SSO-capable deployments
   * (`NEXTAUTH_PROVIDER !== "email"`):
   *   - gate ALLOW: also 403 `/sign-in/email`, `/sign-up/email`, and the
   *     password-reset pair — preserves `main`'s guarantee that a licensed
   *     Auth0/Okta install can't mint a password account (v5 BLOCKER fix).
   *   - gate DENY: 403 the SSO-initiation and callback paths (Constants
   *     table in the ADR) instead — the deployment runs as if the SSO env
   *     vars were unset. The password-reset pair is intentionally left OUT
   *     of the deny branch (v6): every existing user on a denied install is
   *     OAuth-born with no password, so reset is the inbox-proof
   *     self-recovery door (Decision 4 exception).
   */
  hooks: {
    before: async (ctx) => {
      const url = ctx.request?.url ?? "";
      const pathname = normalizedRequestPathname(url);

      // ADR-117 §7: shadow mode's entire live-path footprint. It runs before
      // the email-mode early return on purpose — an email-mode deployment is a
      // routing decision the router has to agree with too, and it is the
      // commonest one in the fleet. With the flag off it returns having read
      // nothing, computed nothing and logged nothing.
      await runSignInRouterShadow({ pathname, url, body: ctx.body });

      // Deployments that name no federated method never register an IdP, so
      // there is no policy to enforce — leave every route untouched (zero
      // behavior change from `main`). Synchronous by contract (ADR-117 §4):
      // an email-mode deployment must not wait on the licensing store to be
      // told it has nothing to wait for.
      if (!deploymentIsFederationCapable()) return;

      // Credential-mutation block: keyed off the CONFIGURED mode, blocked in
      // every gate state (ADR-027 Constants table). The password-reset pair
      // is excluded here — it's gate-dependent, handled below.
      if (isCredentialMutationPath(pathname)) {
        throw APIError.from("BAD_REQUEST", {
          code: "EMAIL_PASSWORD_DISABLED",
          message:
            "Credential management is disabled in cloud/SSO mode — your account is managed by your identity provider.",
        });
      }

      const isResetPath = isPasswordResetPath(pathname);

      // Nothing below this line can change the answer for the rest of the
      // route table, so it never waits on the gate (see `isGateDependentPath`).
      if (!isGateDependentPath(url)) return;

      // ADR-117 §4: the hook is the ENFORCEMENT BACKSTOP now, and it asks the
      // router's method policy rather than raw env. The decision moved to
      // where the data is; enforcement stayed here, because absence from a
      // picker is not enforcement — a pinned legacy callback URL never renders
      // one, and this is still the only interception point that sees the
      // `/callback/auth0|okta` rewrite. Every ADR-027 semantic is unchanged:
      // the gate inside the policy is the same per-process memo, so a license
      // still takes effect on restart and never mid-flight.
      const policy = await resolveSignInMethodPolicy();

      if (policy.federationLicensed) {
        // Gate ALLOW (site #3): refuse the routes that would otherwise mint a
        // password account on a licensed SSO-capable deployment (v5 BLOCKER).
        if (refusesCredentialRoute({ pathname, isResetPath, policy })) {
          throw APIError.from("BAD_REQUEST", {
            code: "EMAIL_PASSWORD_DISABLED",
            message:
              "Credential management is disabled — your account is managed by your identity provider.",
          });
        }
        return;
      }

      // Gate DENY (site #2): run in email mode, exactly as if the SSO env vars
      // were unset. The reset pair stays open so OAuth-born users self-recover.
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
    },
  },
});

export type Auth = typeof auth;
