// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * The better-auth route table, and the reviewed classification of it, shared
 * by both gate canaries: the one over the pure path predicate
 * (`ssoRouteTableCanary.test.ts`) and the one over the enforcement backstop
 * the `before` hook became (ADR-117 §4,
 * `src/server/better-auth/__tests__/ssoRouteTableCanary.test.ts`).
 *
 * One table, deliberately. Two copies would drift, and the moment they drifted
 * one canary would be green about a route the other had never heard of — which
 * is the exact failure the canary exists to make impossible.
 */

import { betterAuth } from "better-auth";
import { memoryAdapter } from "better-auth/adapters/memory";
import { genericOAuth } from "better-auth/plugins";

/**
 * Mirrors the production configuration's federation surface: a social
 * provider plus `genericOAuth`.
 *
 * Since better-auth 1.7 the plugin mounts no routes of its own — it registers
 * each config as a first-class social provider, and federation runs through
 * the core `/sign-in/social` and `/callback/:id`. It stays configured here
 * anyway: the point of this instance is to enumerate what production mounts,
 * and a plugin that goes back to mounting its own endpoints has to show up as
 * an unclassified route rather than as nothing at all.
 */
const buildAuth = () =>
  betterAuth({
    baseURL: "http://localhost:3000",
    secret: "test-secret-test-secret-test-secret",
    database: memoryAdapter({
      user: [],
      session: [],
      account: [],
      verification: [],
    }),
    emailAndPassword: { enabled: true },
    socialProviders: {
      github: { clientId: "client-id", clientSecret: "client-secret" },
    },
    plugins: [
      genericOAuth({
        config: [
          {
            providerId: "oauth2",
            clientId: "client-id",
            clientSecret: "client-secret",
            authorizationUrl: "https://idp.example.com/authorize",
            tokenUrl: "https://idp.example.com/token",
          },
        ],
      }),
    ],
  });

/**
 * Every route better-auth mounts under the configuration above, classified by
 * whether reaching it can start or extend a federated login.
 *
 * `federating` routes must be refused while the platform gate denies, so the
 * deployment behaves as if the SSO env vars were unset. `local` routes are
 * the email/session/account surface that has to keep working in exactly that
 * state, so refusing one would break the coerced email mode instead of
 * protecting it.
 */
export const ROUTE_CLASSIFICATION: Record<string, "federating" | "local"> = {
  // Federation: initiation and provider hand-back.
  "/sign-in/social": "federating",
  "/callback/:id": "federating",
  "/link-social": "federating",
  // `/sign-in/oauth2`, `/oauth2/callback/:providerId` and `/oauth2/link` were
  // here until better-auth 1.7. The genericOAuth plugin used to mount its own
  // parallel family of endpoints; it now registers each config as a
  // first-class social provider instead and mounts NOTHING, so every
  // federated login — Auth0, Okta, any OIDC provider — rides the three routes
  // above. The gate is unchanged in effect: those three were already
  // classified `federating` and already refused, which is why this rewrite
  // left nothing unclassified.

  // Session and identity reads: gate-independent by construction.
  "/get-session": "local",
  "/sign-out": "local",
  "/list-sessions": "local",
  "/revoke-session": "local",
  "/revoke-sessions": "local",
  "/revoke-other-sessions": "local",
  "/update-session": "local",
  "/ok": "local",
  "/error": "local",

  // Password and email surface: refused on gate-ALLOW by the email-auth and
  // credential-mutation predicates, open on DENY (the reset pair is the
  // self-recovery door for OAuth-born users).
  "/sign-up/email": "local",
  "/sign-in/email": "local",
  "/request-password-reset": "local",
  "/reset-password": "local",
  "/reset-password/:token": "local",
  "/change-password": "local",
  "/verify-password": "local",
  "/change-email": "local",
  "/send-verification-email": "local",
  "/verify-email": "local",

  // Account management. `/delete-user/callback` ends in the word "callback"
  // but hands nothing back from an identity provider.
  "/update-user": "local",
  "/delete-user": "local",
  "/delete-user/callback": "local",
  "/list-accounts": "local",
  "/unlink-account": "local",
  "/account-info": "local",
  "/refresh-token": "local",
  "/get-access-token": "local",
};

/** The mounted route table, as the library reports it. */
export const registeredRoutes = (): { name: string; path: string }[] =>
  Object.entries(buildAuth().api)
    .map(([name, endpoint]) => ({
      name,
      path: (endpoint as { path?: unknown })?.path,
    }))
    .filter((route): route is { name: string; path: string } => {
      return typeof route.path === "string";
    });

/** Route params are placeholders; the gate sees concrete request URLs. */
export const concreteUrl = (
  path: string,
  { trailingSlash = false } = {},
): string => {
  const filled = path
    .replace(":id", "auth0")
    .replace(":providerId", "okta")
    .replace(":token", "reset-token-123");
  return `https://app.example.com/api/auth${filled}${trailingSlash ? "/" : ""}`;
};
