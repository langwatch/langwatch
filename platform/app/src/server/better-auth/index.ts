import { buildSocialProviders } from "@ee/sso/providers";
import { createLogger } from "@langwatch/observability";
import { betterAuth } from "better-auth";
import { env } from "~/env.mjs";
import {
  BACKUP_CODE_COUNT,
  betterAuthInstance,
  databaseHooks as composeDatabaseHooks,
  secondaryStorage as composeSecondaryStorage,
  deploymentIsFederationCapable,
  identityBridgeCeremonies,
  identityCeremonies,
  identityStorageAdapter,
  lastWayInGuard,
  mfaCeremonies,
  PASSWORD_HASH_ROUNDS,
  passkeySignUp,
  passwordResetSessionBridge,
  resolveSignInMethodPolicy,
  sessionClaims,
  sessionRevocation,
  signUpConfirmationEndpoint,
  ssoAssertion,
  ssoRegisteredIssuers,
  twoStepAccount,
} from "~/server/app-layer/identity/runtime";
import { databaseHooks } from "./config/database-hooks";
import { emailAndPassword } from "./config/email-and-password";
import { models } from "./config/models";
import { plugins } from "./config/plugins";
import { rateLimit } from "./config/rate-limit";
import { requestHooks } from "./config/request-hooks";
import { secondaryStorage } from "./config/secondary-storage";
import { resolveTrustedOrigins } from "./trustedOrigins";

/**
 * better-auth, assembled (ADR-129).
 *
 * Nothing here decides anything. Every option is a slice produced by a module
 * under `config/`, every collaborator those slices need comes from the one
 * composition root, and what is left in this file is which slice goes where.
 * The file a reviewer opens to answer "what runs when an account is created"
 * is `BetterAuthDatabaseHooks`; this one answers "what is wired at all".
 */

const logger = createLogger("langwatch:better-auth");

const isBuildTime = !!process.env.BUILD_TIME;

/**
 * The store better-auth is configured with, resolved once because
 * `betterAuth()` below is constructed once and the rate limiter has to know
 * whether it is counting in a shared store or in this pod's memory.
 */
const store = secondaryStorage(composeSecondaryStorage());

export const auth = betterAuth({
  baseURL: isBuildTime ? "http://localhost" : env.NEXTAUTH_URL,
  /**
   * Our own address, plus the identity providers our customers registered —
   * the list the SSO plugin checks a discovery URL against before it will
   * fetch one.
   *
   * A FUNCTION, because the answer is not fixed at boot. Every customer
   * brings their own issuer, so no list we could ship contains the next
   * one; what makes an issuer trusted is an administrator of that
   * organization having registered it. Resolved per request, and only
   * single sign-on requests pay for the read. See `trustedOrigins.ts`.
   */
  trustedOrigins: isBuildTime
    ? []
    : async (request) =>
        resolveTrustedOrigins({
          nextAuthUrl: env.NEXTAUTH_URL,
          baseHost: env.BASE_HOST,
          trustedIdpOrigins: env.SSO_TRUSTED_IDP_ORIGINS,
          idpSimulatorUrl: env.LANGWATCH_IDPSIM_URL,
          // Scoped to the connection this request names, not every issuer we
          // hold: the same list gates the Origin header and `callbackURL`, so
          // the whole set made one tenant's registered origin a redirect
          // target on the single sign-on endpoints for every other tenant.
          registeredIssuers:
            await ssoRegisteredIssuers().issuersForRequest(request),
          isProduction: env.NODE_ENV === "production",
        }),
  secret: isBuildTime ? "build-time-only" : env.NEXTAUTH_SECRET,
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
  database: identityStorageAdapter(),

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

  ...models(),

  emailAndPassword: emailAndPassword({
    hashRounds: PASSWORD_HASH_ROUNDS,
    revokeAllSessions: ({ userId }) =>
      sessionRevocation().revokeAll({ userId }),
    recordPasswordReset: ({ userId }) =>
      passwordResetSessionBridge().recordPasswordReset({ userId }),
  }),

  rateLimit: rateLimit({ hasSecondaryStorage: !!store }),

  secondaryStorage: store,
  socialProviders: buildSocialProviders(env),

  plugins: plugins({
    backupCodeCount: BACKUP_CODE_COUNT,
    passkeySignUp,
    confirmSignUpAddress: (ctx) =>
      signUpConfirmationEndpoint().confirmSignUpAddress(ctx),
    ssoAssertion,
  }),

  databaseHooks: databaseHooks({
    hooks: composeDatabaseHooks,
    userErasure: identityCeremonies,
    accountCeremonies: identityBridgeCeremonies,
    sessionClaims,
  }),

  // BetterAuth logger wiring
  logger: {
    disabled: false,
    log: (level, message, ...args) => {
      (logger as any)[level]?.({ args }, message);
    },
  },

  hooks: requestHooks({
    refuseIfItClosesTheLastDoor: (args) =>
      lastWayInGuard().refuseIfItClosesTheLastDoor(args),
    requiringOrganizations: ({ userId }) =>
      twoStepAccount().requiringOrganizations({ userId }),
    deploymentIsFederationCapable,
    resolveSignInMethodPolicy,
    twoStepCeremonies: mfaCeremonies,
    signInAfterPasswordReset: (ctx) =>
      passwordResetSessionBridge().signInAfterPasswordReset(ctx),
  }),
});

// The two identity adapters that call better-auth's own endpoints are handed
// the instance from here, rather than importing this module: the boundary
// depends on the composition root, never the reverse (ADR-129).
betterAuthInstance().provide(auth);

export type Auth = typeof auth;
