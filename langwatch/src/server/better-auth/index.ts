import { betterAuth, type BetterAuthOptions } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { APIError } from "better-auth/api";
import { auth0, genericOAuth, okta } from "better-auth/plugins/generic-oauth";
import { compare, hash } from "bcrypt";

import { env } from "~/env.mjs";
import { prisma } from "~/server/db";
import { connection as redisConnection } from "~/server/redis";
import { createLogger } from "../../utils/logger/server";
import { fireActivityTrackingNurturing } from "../../../ee/billing/nurturing/hooks/activityTracking";
import { ensureUserSyncedToCio } from "../../../ee/billing/nurturing/hooks/userSync";
import {
  afterAccountUpdate,
  afterSessionCreate,
  afterUserCreate,
  beforeAccountCreate,
  beforeSessionCreate,
  beforeUserCreate,
} from "./hooks";

const logger = createLogger("langwatch:better-auth");

/**
 * Derives a user display name from an OAuth profile, falling back through
 * progressively less-preferred fields. BetterAuth's base User schema requires
 * `name: string` (non-nullable), but many providers return profiles with
 * `name: null` for users who never set a display name — GitHub falls back to
 * `login`, GitLab to `username`, Auth0 to `nickname`. If all of those are
 * missing, we use the email prefix as a last resort.
 *
 * Exported for unit testing.
 */
export const fallbackName = (profile: Record<string, any>): string => {
  return (
    (typeof profile.name === "string" && profile.name.trim()) ||
    (typeof profile.nickname === "string" && profile.nickname.trim()) ||
    (typeof profile.displayName === "string" && profile.displayName.trim()) ||
    (typeof profile.login === "string" && profile.login.trim()) ||
    (typeof profile.username === "string" && profile.username.trim()) ||
    (typeof profile.preferred_username === "string" &&
      profile.preferred_username.trim()) ||
    (typeof profile.email === "string" && profile.email.split("@")[0]) ||
    "User"
  );
};

const socialProviders: NonNullable<BetterAuthOptions["socialProviders"]> = {};

if (env.NEXTAUTH_PROVIDER === "google" && env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET) {
  socialProviders.google = {
    clientId: env.GOOGLE_CLIENT_ID,
    clientSecret: env.GOOGLE_CLIENT_SECRET,
    mapProfileToUser: (profile) => ({
      name: fallbackName(profile as Record<string, any>),
      email: (profile as { email?: string }).email,
      image: (profile as { picture?: string }).picture,
    }),
  };
}

if (env.NEXTAUTH_PROVIDER === "github" && env.GITHUB_CLIENT_ID && env.GITHUB_CLIENT_SECRET) {
  socialProviders.github = {
    clientId: env.GITHUB_CLIENT_ID,
    clientSecret: env.GITHUB_CLIENT_SECRET,
    mapProfileToUser: (profile) => ({
      name: fallbackName(profile as Record<string, any>),
      email: (profile as { email?: string }).email,
      image: (profile as { avatar_url?: string }).avatar_url,
    }),
  };
}

if (env.NEXTAUTH_PROVIDER === "gitlab" && env.GITLAB_CLIENT_ID && env.GITLAB_CLIENT_SECRET) {
  socialProviders.gitlab = {
    clientId: env.GITLAB_CLIENT_ID,
    clientSecret: env.GITLAB_CLIENT_SECRET,
    mapProfileToUser: (profile) => ({
      name: fallbackName(profile as Record<string, any>),
      email: (profile as { email?: string }).email,
      image: (profile as { avatar_url?: string }).avatar_url,
    }),
  };
}

if (
  env.NEXTAUTH_PROVIDER === "azure-ad" &&
  env.AZURE_AD_CLIENT_ID &&
  env.AZURE_AD_CLIENT_SECRET &&
  env.AZURE_AD_TENANT_ID
) {
  socialProviders.microsoft = {
    clientId: env.AZURE_AD_CLIENT_ID,
    clientSecret: env.AZURE_AD_CLIENT_SECRET,
    tenantId: env.AZURE_AD_TENANT_ID,
    mapProfileToUser: (profile) => ({
      name: fallbackName(profile as Record<string, any>),
      email:
        (profile as { email?: string; mail?: string; userPrincipalName?: string })
          .email ??
        (profile as { mail?: string }).mail ??
        (profile as { userPrincipalName?: string }).userPrincipalName,
    }),
  };
}

const genericOAuthConfigs: Parameters<typeof genericOAuth>[0]["config"] = [];

/**
 * Forgiving issuer URL parser. Accepts:
 *   - `https://tenant.us.auth0.com/`
 *   - `https://tenant.us.auth0.com` (no trailing slash)
 *   - `tenant.us.auth0.com` (no scheme — auto-prepends https://)
 *
 * Throws a clear error message if the issuer is unparseable, instead of
 * the cryptic native `TypeError: Invalid URL` that crashes deep in the
 * Next.js instrumentation hook with no indication that the OAuth issuer
 * env var is the cause.
 *
 * Exported for unit testing.
 */
export const parseIssuerUrl = (issuer: string, envName: string): URL => {
  const normalized = /^https?:\/\//i.test(issuer)
    ? issuer
    : `https://${issuer}`;
  try {
    return new URL(normalized);
  } catch {
    throw new Error(
      `Invalid ${envName}: "${issuer}" is not a valid URL. Expected something like "https://tenant.us.auth0.com/".`,
    );
  }
};

if (
  env.NEXTAUTH_PROVIDER === "auth0" &&
  env.AUTH0_CLIENT_ID &&
  env.AUTH0_CLIENT_SECRET &&
  env.AUTH0_ISSUER
) {
  const issuerUrl = parseIssuerUrl(env.AUTH0_ISSUER, "AUTH0_ISSUER");
  genericOAuthConfigs.push({
    ...auth0({
      clientId: env.AUTH0_CLIENT_ID,
      clientSecret: env.AUTH0_CLIENT_SECRET,
      domain: issuerUrl.host,
    }),
    // The `prompt=login` forces Auth0 to always show the login screen
    // instead of silently using an existing session — matches the original
    // NextAuth Auth0Provider behavior (`authorization: { params: { prompt: "login" } }`).
    authorizationUrlParams: { prompt: "login" },
    // Pin the OAuth `redirect_uri` to the LEGACY NextAuth callback path
    // (`/api/auth/callback/auth0`). BetterAuth's genericOAuth plugin
    // defaults to `/api/auth/oauth2/callback/auth0`, but existing customer
    // Auth0 applications have only the legacy path registered as an
    // allowed callback. Sending a different `redirect_uri` would cause
    // Auth0 to reject the authorization request.
    // The legacy path is wired back to BetterAuth's plugin handler via
    // a Next.js rewrite in `next.config.mjs`.
    redirectURI: `${env.NEXTAUTH_URL}/api/auth/callback/auth0`,
    mapProfileToUser: (profile) => ({
      name: fallbackName(profile),
      email: profile.email,
      image: profile.picture,
    }),
  });
}

if (
  env.NEXTAUTH_PROVIDER === "okta" &&
  env.OKTA_CLIENT_ID &&
  env.OKTA_CLIENT_SECRET &&
  env.OKTA_ISSUER
) {
  // Normalize issuer to a full URL — BetterAuth's okta helper builds the
  // discovery URL by string concatenation and would otherwise fail
  // silently at first sign-in if the issuer has no scheme.
  const oktaIssuerUrl = parseIssuerUrl(env.OKTA_ISSUER, "OKTA_ISSUER");
  genericOAuthConfigs.push({
    ...okta({
      clientId: env.OKTA_CLIENT_ID,
      clientSecret: env.OKTA_CLIENT_SECRET,
      issuer: oktaIssuerUrl.toString().replace(/\/$/, ""),
    }),
    // Same backward-compat reasoning as auth0 above — pin the legacy
    // NextAuth callback path so existing Okta applications don't need
    // their allowed callback list updated during cutover.
    redirectURI: `${env.NEXTAUTH_URL}/api/auth/callback/okta`,
    mapProfileToUser: (profile) => ({
      name: fallbackName(profile),
      email: profile.email,
      image: profile.image ?? profile.picture,
    }),
  });
}

// NOTE: BetterAuth's admin plugin is intentionally NOT used. It expects
// `User.role` and `User.banned` columns which our schema doesn't have, and
// it would override admin impersonation with its own mechanism. We use our
// own `isAdmin` check (ee/admin/isAdmin.ts) and the legacy
// Session.impersonating JSON column handled in src/server/auth.ts.
const plugins =
  genericOAuthConfigs.length > 0
    ? [genericOAuth({ config: genericOAuthConfigs })]
    : [];

/**
 * Wire BetterAuth's secondary storage to the shared Redis connection.
 * Used by rate limiting (below) so limits are enforced across pods.
 * Falls back to in-memory when Redis isn't configured (build time, tests).
 */
const secondaryStorage: BetterAuthOptions["secondaryStorage"] = redisConnection
  ? {
      get: async (key) => {
        const value = await redisConnection!.get(`better-auth:${key}`);
        return value;
      },
      set: async (key, value, ttl) => {
        if (ttl) {
          await redisConnection!.set(`better-auth:${key}`, value, "EX", ttl);
        } else {
          await redisConnection!.set(`better-auth:${key}`, value);
        }
      },
      delete: async (key) => {
        await redisConnection!.del(`better-auth:${key}`);
      },
    }
  : undefined;

const isBuildTime = !!process.env.BUILD_TIME;

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
      ipAddressHeaders: [
        "cf-connecting-ip",
        "x-forwarded-for",
        "x-real-ip",
      ],
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
   */
  emailAndPassword: {
    enabled: env.NEXTAUTH_PROVIDER === "email",
    password: {
      hash: async (password: string) => hash(password, 10),
      verify: async ({ password, hash: storedHash }) => compare(password, storedHash),
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
            user: user as { email: string; deactivatedAt?: Date | null } & Record<string, unknown>,
          }),
        after: async (user) => {
          await afterUserCreate({ prisma, user: user as { id: string; email: string } });
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
   */
  hooks: {
    before: async (ctx) => {
      if (env.NEXTAUTH_PROVIDER !== "email") {
        const url = ctx.request?.url ?? "";
        // The request URL is the FULL URL after Next.js routing, so we
        // check for suffix matches on the BetterAuth endpoint paths.
        const matches = (suffix: string) =>
          url.endsWith(suffix) || url.includes(`${suffix}?`);
        // All endpoints that mutate or read credential state and are
        // NOT gated by `emailAndPassword.enabled` at the handler level.
        // We defense-in-depth these in cloud mode to prevent bypasses
        // of the iter-26 revokeOtherSessionsForUser wiring and any
        // other cloud-mode invariants our application layer expects.
        if (
          matches("/change-password") ||
          matches("/set-password") ||
          matches("/change-email") ||
          matches("/request-password-reset") ||
          matches("/reset-password") ||
          matches("/send-verification-email") ||
          matches("/verify-email")
        ) {
          throw APIError.from("BAD_REQUEST", {
            code: "EMAIL_PASSWORD_DISABLED",
            message:
              "Credential management is disabled in cloud/SSO mode — your account is managed by your identity provider.",
          });
        }
      }
    },
  },
});

export type Auth = typeof auth;
