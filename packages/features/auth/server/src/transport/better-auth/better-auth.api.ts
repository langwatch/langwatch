import { passkey } from "@better-auth/passkey";
import {
  isCredentialMutationPath,
  isEmailAuthPath,
  isGateDependentPath,
  isGatedSsoPath,
  isPasswordResetPath,
  normalizedRequestPathname,
  requestPathname,
} from "@langwatch/enterprise-sso-contract";
import { createLogger } from "@langwatch/observability";
import type { AuthService } from "@langwatch/auth-contract";
import type { SignInMethodPolicy } from "@langwatch/identity-contract";
import type { PrismaClient } from "@langwatch/prisma-client/generated";
import type { UserService } from "@langwatch/user-contract";
import type { RedisConnection } from "@langwatch/redis-client";
import { compare, hash } from "bcrypt";
import { type BetterAuthOptions, betterAuth } from "better-auth";
import { APIError } from "better-auth/api";
import { genericOAuth } from "better-auth/plugins/generic-oauth";
import { twoFactor } from "better-auth/plugins/two-factor";
import type {
  BetterAuthAnnouncementsPort,
  BetterAuthFederationPort,
  BetterAuthIdentityCeremoniesPort,
  BetterAuthPendingInvitePort,
  BetterAuthStoragePort,
} from "../../ports/better-auth.port";
import {
  afterAccountCreate,
  afterAccountUpdate,
  afterSessionCreate,
  afterUserCreate,
  beforeAccountCreate,
  beforeSessionCreate,
  beforeUserCreate,
  type BetterAuthHookCollaborators,
} from "./better-auth-hooks";
import { passkeySignUpRegistration, type SignUpVerificationPort } from "./passkey-sign-up";
import {
  runSignInRouterShadow,
  type SignInRouterShadowPort,
} from "./sign-in-router-shadow";

const logger = createLogger("langwatch:better-auth");

/**
 * Everything about this deployment the option set is built from.
 *
 * It used to be twelve `~/env.mjs` reads scattered through the module, several
 * of them at module load, which is what made the instance impossible to
 * compose twice and impossible to test without mutating a process. Read once
 * by the process that owns its environment and handed over whole.
 */
export type BetterAuthDeploymentConfiguration = Readonly<{
  /** `betterAuth({ baseURL })` — where this instance believes it is served. */
  baseUrl: string;
  /**
   * The externally reachable origin, where a proxy makes it differ from
   * {@link baseUrl}. Behind a reverse proxy (preview deploys, tunnels) this is
   * the address the browser used; both are trusted so sign-in does not fail
   * with "Invalid origin", and links in mail are built from this one.
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
  /** Social providers this deployment mounted, already built. */
  socialProviders: NonNullable<BetterAuthOptions["socialProviders"]>;
  /** Generic-OIDC connections this deployment mounted, already built. */
  genericOAuthConfigs: readonly Parameters<typeof genericOAuth>[0]["config"][number][];
}>;

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
 * Exported so the credentials gate can be asserted per provider without
 * standing an instance up under a different environment.
 */
export const isEmailPasswordEnabled = (deployment: {
  authProvider: string | undefined;
  isSaas: boolean;
}): boolean => deployment.authProvider === "email" || !deployment.isSaas;

/**
 * Wires Better Auth's secondary storage to the process's Redis connection.
 * Used by rate limiting (below) so limits are enforced across pods.
 *
 * WHETHER to configure it changes the instance's session strategy, so a
 * deployment with no Redis must get `undefined` and keep its sessions in the
 * database. The decision used to be read from environment (ADR-093) because
 * the instance was constructed at module load and no client existed yet; the
 * instance is now composed by the process, which already holds the connection
 * or does not — so the presence of the connection IS the answer, and there is
 * no second place for the two to disagree.
 */
function createSecondaryStorage(
  redis: RedisConnection | null,
): BetterAuthOptions["secondaryStorage"] {
  if (!redis) return undefined;
  return {
    get: async (key) => {
      return await redis.get(`better-auth:${key}`);
    },
    // Read-and-clear in one round trip, so two callers racing for a
    // single-use value cannot both be handed it. `GETDEL` is what the
    // rest of the app already uses for exactly this (the scenario tab
    // registry, the GitHub install nonce).
    getAndDelete: async (key) => {
      return await redis.getdel(`better-auth:${key}`);
    },
    // The counter behind distributed rate limiting. Required by
    // better-auth 1.7 — before it, the limiter read and wrote a serialized
    // record, which two pods could interleave.
    //
    // The TTL is applied ONLY on creation, which is the whole shape of a
    // fixed window: extending it on every hit would mean a key under
    // sustained traffic never expires, and the limit becomes permanent
    // rather than per-window.
    increment: async (key, ttl) => {
      const namespaced = `better-auth:${key}`;
      const count = await redis.incr(namespaced);
      if (count === 1) await redis.expire(namespaced, ttl);
      return count;
    },
    set: async (key, value, ttl) => {
      if (ttl) {
        await redis.set(`better-auth:${key}`, value, "EX", ttl);
      } else {
        await redis.set(`better-auth:${key}`, value);
      }
    },
    delete: async (key) => {
      await redis.del(`better-auth:${key}`);
    },
  };
}

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

/**
 * Builds the Better Auth transport around the process-owned mailer.
 *
 * The API composition root supplies the process dependencies during
 * construction. Factor plugins are selected for that instance so importing
 * this module cannot register process behavior.
 */
const createAuthOptions = ({
  prisma,
  deployment,
  storage,
  federation,
  identity,
  shadow,
  hooks,
}: {
  prisma: PrismaClient;
  deployment: BetterAuthDeploymentConfiguration;
  storage: BetterAuthStoragePort;
  federation: BetterAuthFederationPort;
  identity: BetterAuthIdentityCeremoniesPort;
  shadow: SignInRouterShadowPort;
  hooks: BetterAuthHookCollaborators;
}): BetterAuthOptions & {
  // `emailAndPassword` is optional on `BetterAuthOptions` but this factory
  // always states it, and `enabled` inside it is REQUIRED. Saying so keeps the
  // spread below from degrading the credentials gate to "unset", which
  // better-auth would then have to guess at.
  emailAndPassword: NonNullable<BetterAuthOptions["emailAndPassword"]>;
} => ({
  baseURL: deployment.baseUrl,
  trustedOrigins: [
    deployment.baseUrl,
    // Behind a reverse proxy (preview deploys, tunneling services), the
    // public base URL is the external one while the base URL may be the
    // internal one. Accept both so sign-in/sign-up don't fail with
    // "Invalid origin".
    ...(deployment.publicBaseUrl && deployment.publicBaseUrl !== deployment.baseUrl
      ? [deployment.publicBaseUrl]
      : []),
  ],
  secret: deployment.secret,
  /**
   * The identity storage adapter (ADR-116 §1) — one `database:` entry,
   * forever. It IS the implementation `createAdapterFactory` is built
   * around, which is what puts better-auth's own traffic (its join
   * emulation, its transactions) on it rather than below it, and inside it
   * a per-user gate routes between the stock Prisma behaviour and
   * event-sourced storage.
   *
   * The gate ships CLOSED, so every user takes the legacy branch — the
   * stock engine, byte for byte — until an operator enrols one and their
   * identifier backfill finalizes. Deploying this changes nothing on its
   * own; `identity-storage-adapter-legacy.unit.test.ts` is the proof,
   * walking the whole flow over both engines and comparing transcripts.
   */
  database: storage.adapter() as NonNullable<BetterAuthOptions["database"]>,

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
     * Wires BetterAuth's /request-password-reset endpoint to our existing
     * transactional mailer (SendGrid / SES via `sendEmail`). Without this the
     * endpoint returns RESET_PASSWORD_DISABLED. We ignore BetterAuth's default
     * `url` and build the link off BASE_HOST + the issued token so it lands on
     * our own /auth/reset-password page. Reset is deliberately reachable on a
     * deployment the SSO license gate denies, even with an IdP configured
     * (ADR-027), so that a user whose account was born through that IdP can
     * still recover through their inbox. It closes again once the gate allows.
     */
    /**
     * After a successful reset, force-logout every existing session for the
     * user. The self-service change-password flow revokes *other* sessions
     * (keeping the current tab); here the user isn't signed in, and a reset is
     * the recovery path for a possibly-compromised account, so we revoke all.
     */
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
    storage: "memory",
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
      // Passkey sign-up drops the session requirement from these two, so they
      // are an unauthenticated way to create an account and are limited as
      // one — alongside `/sign-up/email`, which is the same thing by another
      // door. Options are generated once per attempt and verification runs
      // only after a system prompt, so a person doing this by hand never
      // approaches either number.
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
            collaborators: hooks,
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
          await identity.beforeUserDelete(user as { id: string });
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
            federation,
          });
          // ADR-101 §2: the account row is an identifier attach. Returning
          // the row data pins its id, which is what makes the live
          // identifier id and the backfill's derived id the same id.
          //
          // The BRIDGE ceremonies, not the bare ones (ADR-116 §5): the
          // storage adapter states this fact itself for every user it routes
          // to the identity branch, and a hook that stated it too would
          // append the event twice whenever the first fold had not landed.
          return identity.beforeAccountCreate(account);
        },
        after: async (account) => {
          if (!account.userId || !account.providerId || !account.accountId) return;
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
          if (!account.userId || !account.providerId || !account.accountId) return;
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
        /** ADR-101 §2: an account row removed is an identifier detach — and
         *  the adapter's own, for anyone it routes to the identity branch. */
        before: async (account) => {
          await identity.beforeAccountDelete(account);
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
   * Block them here so a legacy credential row cannot bypass the application
   * password change and session-revocation flow.
   *
   * In SSO mode, ADR-027 uses this same memoized gate: allow blocks email
   * sign-in, sign-up and reset; deny blocks SSO initiation/callback instead.
   * Reset remains available when SSO is denied because OAuth-only users need
   * an account-recovery path.
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
      await runSignInRouterShadow({ pathname, url, body: ctx.body, shadow });

      // Deployments that name no federated method never register an IdP, so
      // there is no policy to enforce — leave every route untouched (zero
      // behavior change from `main`). Synchronous by contract (ADR-117 §4):
      // an email-mode deployment must not wait on the licensing store to be
      // told it has nothing to wait for.
      if (!federation.federationCapable()) return;

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
      const policy = await federation.resolveSignInMethodPolicy();

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

/**
 * The generic-OIDC plugin, mounted only when this deployment configured a
 * connection for it.
 *
 * A function rather than a module constant: the connections are the
 * deployment's, so a process composing this instance twice with two different
 * option sets must get two different plugin lists rather than whichever one
 * loaded first.
 */
function genericOAuthPlugins(
  deployment: BetterAuthDeploymentConfiguration,
): NonNullable<BetterAuthOptions["plugins"]> {
  if (deployment.genericOAuthConfigs.length === 0) return [];
  return [genericOAuth({ config: [...deployment.genericOAuthConfigs] })];
}

/**
 * Everything the deployment's one Better Auth instance is built from.
 *
 * NOTE: Better Auth's admin plugin is deliberately NOT mounted. It expects
 * `User.role` and `User.banned` columns this schema does not have, and it
 * would override admin impersonation with its own mechanism; the product uses
 * its own admin check and the `Session.impersonating` column.
 */
export type BetterAuthTransportOptions = Readonly<{
  /** The Auth service whose sessions this instance mints and revokes. */
  auth: AuthService;
  /** The typed client every database hook reads and writes through. */
  database: PrismaClient;
  /** The instance's storage engine — see {@link BetterAuthStoragePort}. */
  storage: BetterAuthStoragePort;
  deployment: BetterAuthDeploymentConfiguration;
  federation: BetterAuthFederationPort;
  identity: BetterAuthIdentityCeremoniesPort;
  invites: BetterAuthPendingInvitePort;
  announcements: BetterAuthAnnouncementsPort;
  shadow: SignInRouterShadowPort;
  /** The grant ledger an SSO auto-join writes its membership through. */
  authzGrants: BetterAuthHookCollaborators["authzGrants"];
  /**
   * Sends the password-reset link.
   *
   * The whole send, not a gateway plus a URL: the process owns both halves —
   * the host every link points at and the mail gateway it leaves through —
   * and splitting them here would let one instance build a link for a host
   * the other sends from.
   */
  sendResetPassword: (input: { email: string; token: string }) => Promise<void>;
  /** The process's Redis, or null to keep sessions in the database alone. */
  redis: RedisConnection | null;
  signUpVerification: SignUpVerificationPort;
  users: UserService;
}>;

/**
 * Builds the deployment's ONE Better Auth instance.
 *
 * Every collaborator arrives as a parameter, and that is the point: a second
 * instance built from a different option set verifies nothing and answers
 * `null` to every caller, which reads as "signed out" rather than as a fault.
 * A process composes this once and shares the result.
 */
export const createBetterAuthTransport = ({
  announcements,
  auth,
  authzGrants,
  database,
  deployment,
  federation,
  identity,
  invites,
  redis,
  sendResetPassword,
  shadow,
  signUpVerification,
  storage,
  users,
}: BetterAuthTransportOptions) => {
  const secondaryStorage = createSecondaryStorage(redis);
  const authOptions = createAuthOptions({
    prisma: database,
    deployment,
    storage,
    federation,
    identity,
    shadow,
    hooks: { federation, invites, announcements, authzGrants },
  });
  return betterAuth({
    ...authOptions,
    plugins: [
      ...genericOAuthPlugins(deployment),
      ...(deployment.mfaEnrollmentOpen ? [twoFactor()] : []),
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
    ],
    secondaryStorage,
    rateLimit: {
      ...authOptions.rateLimit,
      storage: secondaryStorage ? "secondary-storage" : "memory",
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
