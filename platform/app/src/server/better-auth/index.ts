import { buildSocialProviders } from "@ee/sso/providers";
import { createLogger } from "@langwatch/observability";
import { betterAuth } from "better-auth";

import { env } from "~/env.mjs";
import {
  addressRoutesToConnection,
  BACKUP_CODE_COUNT,
  betterAuthInstance,
  databaseHooks as composeDatabaseHooks,
  secondaryStorage as composeSecondaryStorage,
  credentialSessions,
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
  sessionCallbackEvidence,
  sessionClaims,
  sessionRevocation,
  signInLockout,
  signUpConfirmationEndpoint,
  ssoAssertion,
  ssoProvisionedUsers,
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

/**
 * Where a failed sign-in is sent.
 *
 * Named once and exported because two places have to agree about it: this is
 * what better-auth appends its code and its prose to, and it is what the
 * boundary in `signin-error-redirect.ts` recognises on the way back out. A
 * second copy of the string would let a redirect start slipping past the
 * boundary the moment either moved.
 */
export const SIGN_IN_ERROR_PAGE_URL = `${env.NEXTAUTH_URL}/auth/error`;

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
   * Which header carries the real client IP, and whose word we take for it.
   *
   * This value is the rate-limit bucket key, so whoever chooses it chooses
   * how many attempts they get. That makes it a security control, not a
   * telemetry nicety: it is what stands in front of the 50-per-15-minutes
   * sign-in cap, the 5-per-hour reset caps that close the enumeration
   * side-channel, and the two-factor plugin's 3-per-10-seconds rule - the
   * only brute-force limit in front of a six-digit code.
   *
   * `cf-connecting-ip` and `x-real-ip` are deliberately NOT listed. Both are
   * single-value headers, and better-auth's own documentation says it
   * "cannot verify the direct sender": for a single-value header it returns
   * the value verbatim, `trustedProxies` set or not.
   *
   * `x-forwarded-for` is listed and `trustedProxies` is EMPTY on purpose, and
   * the two together are only safe because of what the route does first. A
   * `Request` carries no connection, so nothing better-auth can reach knows
   * the socket peer, and its own answer would come from whatever the caller
   * wrote. So `routes/auth.ts` resolves the caller from the peer - reading a
   * forwarding header only when that peer is one of the deployment's own hops
   * - and restates the answer as this header before the handler ever sees the
   * request. What arrives here is therefore always single-valued and always
   * ours, which is exactly the shape better-auth takes verbatim.
   *
   * Leaving the operator's list out of this call is what keeps that true: with
   * a list set, better-auth walks the chain and drops any hop it recognises,
   * so a resolved caller that happens to BE the declared proxy would resolve
   * to nothing and fall into the shared bucket. One caller identity, decided
   * once, and the two limiters cannot disagree about who is calling.
   */
  advanced: {
    ipAddress: {
      ipAddressHeaders: ["x-forwarded-for"],
      trustedProxies: [],
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
    errorURL: SIGN_IN_ERROR_PAGE_URL,
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
    ssoProvisionedUsers,
    ssoCallbackEvidence: sessionCallbackEvidence,
  }),

  databaseHooks: databaseHooks({
    hooks: composeDatabaseHooks,
    userErasure: identityCeremonies,
    accountCeremonies: identityBridgeCeremonies,
    sessionClaims,
    providerAssertions: sessionCallbackEvidence,
    credentialSessions,
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
    addressRoutesToConnection,
    signInLockout,
  }),
});

// The two identity adapters that call better-auth's own endpoints are handed
// the instance from here, rather than importing this module: the boundary
// depends on the composition root, never the reverse (ADR-129).
betterAuthInstance().provide(auth);

export type Auth = typeof auth;
