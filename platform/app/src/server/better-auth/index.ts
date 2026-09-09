import { fireActivityTrackingNurturing } from "@ee/billing/nurturing/hooks/activityTracking";
import { ensureUserSyncedToCio } from "@ee/billing/nurturing/hooks/userSync";
import { buildSocialProviders } from "@ee/sso/providers";
import { createLogger } from "@langwatch/observability";
import { betterAuth } from "better-auth";
import { env } from "~/env.mjs";
import {
  BACKUP_CODE_COUNT,
  betterAuthInstance,
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
  sessionCallbackEvidence,
  sessionClaims,
  sessionRevocation,
  signUpConfirmationEndpoint,
  twoStepAccount,
} from "~/server/app-layer/identity/runtime";
import { prisma } from "~/server/db";
import { parseTrustedProxyAddresses } from "~/utils/getClientIp";
import { databaseHooks } from "./config/database-hooks";
import { emailAndPassword } from "./config/email-and-password";
import { models } from "./config/models";
import { plugins } from "./config/plugins";
import { rateLimit } from "./config/rate-limit";
import { requestHooks } from "./config/request-hooks";
import { secondaryStorage } from "./config/secondary-storage";
import {
  afterAccountCreate,
  afterAccountUpdate,
  afterSessionCreate,
  afterUserCreate,
  beforeAccountCreate,
  beforeSessionCreate,
  beforeUserCreate,
} from "./hooks";

/**
 * better-auth, assembled (ADR-129).
 *
 * Nothing here decides anything. Every option is a slice produced by a module
 * under `config/`, every collaborator those slices need comes from the one
 * composition root, and what is left in this file is which slice goes where.
 * The files a reviewer opens to answer "what runs when an account is created"
 * are `config/database-hooks.ts` and the legacy callbacks in `hooks.ts`; this
 * one answers "what is wired at all".
 */

const logger = createLogger("langwatch:better-auth");

const isBuildTime = !!process.env.BUILD_TIME;

/**
 * The store better-auth is configured with, resolved once because
 * `betterAuth()` below is constructed once and the rate limiter has to know
 * whether it is counting in a shared store or in this pod's memory.
 */
const store = secondaryStorage(composeSecondaryStorage());

interface AccountHookRow {
  userId: string;
  providerId: string;
  accountId: string;
}

const legacyDatabaseHooks = () => ({
  beforeUserCreate: ({
    user,
  }: {
    user: { email: string; deactivatedAt?: Date | null } & Record<
      string,
      unknown
    >;
  }) => beforeUserCreate({ prisma, user }),
  afterUserCreate: ({
    user,
  }: {
    user: { id: string; email: string; name: string };
  }) => afterUserCreate({ prisma, user }),
  beforeAccountCreate: ({ account }: { account: AccountHookRow }) =>
    beforeAccountCreate({ prisma, account }),
  afterAccountCreate: ({ account }: { account: AccountHookRow }) =>
    afterAccountCreate({ prisma, account }),
  afterAccountUpdate: ({ account }: { account: AccountHookRow }) =>
    afterAccountUpdate({ prisma, account }),
  beforeSessionCreate: ({ session }: { session: { userId: string } }) =>
    beforeSessionCreate({ prisma, session }),
  afterSessionCreate: ({ userId }: { userId: string }) =>
    afterSessionCreate({
      prisma,
      userId,
      fireActivityTrackingNurturing,
      ensureUserSyncedToCio,
    }),
});

export const auth = betterAuth({
  baseURL: isBuildTime ? "http://localhost" : env.NEXTAUTH_URL,
  trustedOrigins: isBuildTime
    ? []
    : [
        env.NEXTAUTH_URL,
        ...(env.BASE_HOST && env.BASE_HOST !== env.NEXTAUTH_URL
          ? [env.BASE_HOST]
          : []),
      ],
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
   * side-channel, and the two-factor plugin's 3-per-10-seconds rule — the
   * only brute-force limit in front of a six-digit code.
   *
   * `cf-connecting-ip` and `x-real-ip` are deliberately NOT listed. Both are
   * single-value headers, and better-auth's own documentation says it
   * "cannot verify the direct sender": for a single-value header it returns
   * the value verbatim, `trustedProxies` set or not. Anyone who can reach
   * the origin could therefore mint a fresh bucket per request by varying
   * the header, and every cap above would count to one forever.
   *
   * `x-forwarded-for` is the chain form, and it is the only one that can be
   * checked: with `trustedProxies` set, better-auth walks the chain from the
   * right, skips hops we vouch for, and takes the first address we do not.
   * Behind Cloudflare that still yields the true client, because Cloudflare
   * appends to this header too — its ranges just belong in the list.
   *
   * The list comes from `TRUSTED_PROXY_ADDRESSES`, the same setting the
   * platform's own tRPC limiter resolves through `getClientIp`. One
   * deployment fact, read once, so the two limiters cannot disagree about
   * who the caller is.
   */
  advanced: {
    ipAddress: {
      ipAddressHeaders: ["x-forwarded-for"],
      trustedProxies: [...parseTrustedProxyAddresses(env.TRUSTED_PROXY_ADDRESSES)],
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
  }),

  databaseHooks: databaseHooks({
    hooks: legacyDatabaseHooks,
    userErasure: identityCeremonies,
    accountCeremonies: identityBridgeCeremonies,
    sessionClaims,
    providerAssertions: sessionCallbackEvidence,
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
