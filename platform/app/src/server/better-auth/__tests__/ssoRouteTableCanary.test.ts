/**
 * The route-table canary over the ENFORCEMENT BACKSTOP (ADR-117 §4).
 *
 * ADR-027 put the license decision in the `before` hook because the hook was
 * the only interception point that saw the legacy `/callback/auth0|okta`
 * rewrite. ADR-117 moves the DECISION to the router's method policy and leaves
 * the hook as the backstop — which is a mechanism change to the one guard a
 * whole license gate rests on. So the canary is doubled rather than moved:
 *
 *   @langwatch/enterprise-sso-server               the path predicate
 *   this file                                      the HOOK, end to end
 *
 * The Enterprise SSO package owns the exhaustive route-table canary. This
 * app-level check exercises representative federating and local routes through
 * the assembled hook, where method policy meets the transport.
 *
 * Hermetic — memory adapter, no DB, no network — so it stays in the unit
 * bucket despite constructing a real better-auth instance.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("~/server/db", () => ({ prisma: {} }));

// Partial: `createAuth` also reads `ssoConfiguration` and the two provider
// builders out of this module. Only the two gate answers this suite steers are
// replaced; the rest stay the real thing.
vi.mock("~/runtime/app/features/sso", async (importOriginal) => ({
  ...(await importOriginal<typeof import("~/runtime/app/features/sso")>()),
  platformSSOAllowed: vi.fn(),
  resolveAuthProvider: vi.fn(),
}));

vi.mock("~/env.mjs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("~/env.mjs")>();
  return {
    ...actual,
    env: { ...actual.env, NEXTAUTH_PROVIDER: "auth0" },
  };
});

const { loggerMock } = vi.hoisted(() => ({
  loggerMock: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));
vi.mock("@langwatch/observability", () => ({ createLogger: () => loggerMock }));

import type { AuthService } from "@langwatch/auth-contract";
import type { PrismaClient } from "@langwatch/prisma-client";
import type { UserService } from "@langwatch/user-contract";
import type { SignUpVerificationService } from "~/server/app-layer/identity/signup-verification.service";
import { platformSSOAllowed, resolveAuthProvider } from "~/runtime/app/features/sso";
import { createAuth } from "../index";

// `auth` is minted per process now rather than at module scope; the hook under
// test is the same one `createAuthOptions` puts on every instance.
const auth = createAuth({
  auth: { revokeAllBrowserSessions: vi.fn() } as unknown as AuthService,
  database: {} as PrismaClient,
  mailer: { defaultFrom: () => "test@example.com", send: vi.fn() },
  passkeyHandleSecret: "test-secret",
  redis: null,
  signUpVerification: {} as SignUpVerificationService,
  users: {} as UserService,
});

const runBeforeHook = (auth as any).options.hooks.before as (ctx: {
  request?: { url: string };
}) => Promise<void>;

/** The status the hook answered a route with, or null when it let it pass. */
async function refusalStatus(url: string): Promise<number | null> {
  try {
    await runBeforeHook({ request: { url } });
    return null;
  } catch (error) {
    return (error as { statusCode?: number }).statusCode ?? -1;
  }
}

const ROUTES = {
  federating: [
    "/api/auth/sign-in/social",
    "/api/auth/callback/auth0",
    "/api/auth/sign-in/oauth2",
    "/api/auth/oauth2/callback/okta",
  ],
  local: ["/api/auth/get-session", "/api/auth/sign-in/email", "/api/auth/delete-user/callback"],
} as const;

async function statusesByPath(): Promise<Record<string, number | null>> {
  const paths = [...ROUTES.federating, ...ROUTES.local];
  const entries = await Promise.all(
    paths.map(async (path) => [path, await refusalStatus(`https://host${path}`)] as const),
  );
  return Object.fromEntries(entries);
}

const federatingPaths = () => ROUTES.federating;

describe("the better-auth before-hook as the ADR-117 enforcement backstop", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(resolveAuthProvider).mockResolvedValue("auth0");
  });

  describe("given a method policy that carries no licensed federation", () => {
    beforeEach(() => {
      vi.mocked(platformSSOAllowed).mockResolvedValue(false);
    });

    /** @scenario A new federating route cannot appear without being classified */
    it("refuses every federating route the library mounts", async () => {
      const statuses = await statusesByPath();

      expect(Object.fromEntries(federatingPaths().map((path) => [path, statuses[path]]))).toEqual(
        Object.fromEntries(federatingPaths().map((path) => [path, 403])),
      );
    });

    /** @scenario "A never-licensed installation offers no federated method" */
    it("refuses no local route as an SSO refusal", async () => {
      const statuses = await statusesByPath();

      const wronglyForbidden = Object.entries(statuses)
        .filter(([path]) => ROUTES.local.includes(path as (typeof ROUTES.local)[number]))
        .filter(([, status]) => status === 403)
        .map(([path]) => path);

      expect(wronglyForbidden).toEqual([]);
    });
  });

  describe("given a method policy that licenses federation", () => {
    beforeEach(() => {
      vi.mocked(platformSSOAllowed).mockResolvedValue(true);
    });

    it("lets every federating route through", async () => {
      const statuses = await statusesByPath();

      expect(Object.fromEntries(federatingPaths().map((path) => [path, statuses[path]]))).toEqual(
        Object.fromEntries(federatingPaths().map((path) => [path, null])),
      );
    });
  });

  describe("given a deployment that names no federated method", () => {
    beforeEach(() => {
      vi.mocked(platformSSOAllowed).mockResolvedValue(false);
      vi.mocked(resolveAuthProvider).mockResolvedValue("email");
    });

    it("leaves the whole route table alone without consulting the gate", async () => {
      const { env } = await import("~/env.mjs");
      const envMock = env as unknown as { NEXTAUTH_PROVIDER: string };
      const configured = envMock.NEXTAUTH_PROVIDER;
      envMock.NEXTAUTH_PROVIDER = "email";
      try {
        const statuses = await statusesByPath();

        expect(Object.values(statuses).every((s) => s === null)).toBe(true);
        expect(platformSSOAllowed).not.toHaveBeenCalled();
      } finally {
        envMock.NEXTAUTH_PROVIDER = configured;
      }
    });
  });
});
