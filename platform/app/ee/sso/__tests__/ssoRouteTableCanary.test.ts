// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * See specs/licensing/sso-license-gating.feature — "A new federating route
 * cannot appear without being classified".
 *
 * `isGatedSsoPath` refuses a hand-maintained set of federation-shaped paths.
 * That set is correct for the better-auth version pinned today, and the rest
 * of `ssoPathGate.test.ts` proves it. What that cannot prove is that the set
 * still covers the route table after an upgrade: a plugin or version bump
 * that mounts a new way to federate a login would pass straight through the
 * DENY branch, reopening the unlicensed-SSO hole with every other test still
 * green.
 *
 * So this asks the library itself what it mounts, and requires every route to
 * carry a reviewed classification. An added, renamed or removed route fails
 * here by name, which is the moment a human has to decide whether it
 * federates.
 *
 * Deliberately a `.test.ts` (unit bucket) despite constructing a real
 * better-auth instance: it is hermetic — memory adapter, no DB, no network —
 * so it must not pay for the integration globalSetup.
 */

import { betterAuth } from "better-auth";
import { memoryAdapter } from "better-auth/adapters/memory";
import { genericOAuth } from "better-auth/plugins";
import { describe, expect, it } from "vitest";
import { isGatedSsoPath } from "../ssoPathGate";

/**
 * Mirrors the production configuration's federation surface: a social
 * provider (auth0/okta ride `socialProviders`) plus `genericOAuth`, which is
 * what mounts the `/sign-in/oauth2` and `/oauth2/*` family. A narrower
 * instance would enumerate fewer routes and quietly weaken the check.
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
const ROUTE_CLASSIFICATION: Record<string, "federating" | "local"> = {
  // Federation: initiation and provider hand-back.
  "/sign-in/social": "federating",
  "/callback/:id": "federating",
  "/link-social": "federating",
  "/sign-in/oauth2": "federating",
  "/oauth2/callback/:providerId": "federating",
  "/oauth2/link": "federating",

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
const registeredRoutes = (): { name: string; path: string }[] =>
  Object.entries(buildAuth().api)
    .map(([name, endpoint]) => ({
      name,
      path: (endpoint as { path?: unknown })?.path,
    }))
    .filter((route): route is { name: string; path: string } => {
      return typeof route.path === "string";
    });

/** Route params are placeholders; the gate sees concrete request URLs. */
const concreteUrl = (path: string, { trailingSlash = false } = {}): string => {
  const filled = path
    .replace(":id", "auth0")
    .replace(":providerId", "okta")
    .replace(":token", "reset-token-123");
  return `https://app.example.com/api/auth${filled}${trailingSlash ? "/" : ""}`;
};

describe("better-auth route table (ADR-027 gate coverage canary)", () => {
  describe("given the routes better-auth actually mounts", () => {
    /** @scenario A new federating route cannot appear without being classified */
    it("classifies every one of them as federating or local", () => {
      const mounted = registeredRoutes().map((route) => route.path);
      const classified = Object.keys(ROUTE_CLASSIFICATION);

      const unclassified = mounted.filter((p) => !classified.includes(p));
      const stale = classified.filter((p) => !mounted.includes(p));

      // Named rather than counted: the failure message has to say which route
      // appeared, because deciding whether it federates is the whole point.
      expect({ unclassified, stale }).toEqual({ unclassified: [], stale: [] });
    });
  });

  describe("when the gate is asked about each mounted route", () => {
    it("refuses exactly the federating ones", () => {
      const verdicts = registeredRoutes().map((route) => ({
        path: route.path,
        gated: isGatedSsoPath(concreteUrl(route.path)),
      }));

      const expected = verdicts.map((v) => ({
        path: v.path,
        gated: ROUTE_CLASSIFICATION[v.path] === "federating",
      }));

      expect(verdicts).toEqual(expected);
    });

    it("reaches the same verdict for the trailing-slash form the router accepts", () => {
      for (const route of registeredRoutes()) {
        expect({
          path: route.path,
          gated: isGatedSsoPath(
            concreteUrl(route.path, { trailingSlash: true }),
          ),
        }).toEqual({
          path: route.path,
          gated: ROUTE_CLASSIFICATION[route.path] === "federating",
        });
      }
    });
  });
});
