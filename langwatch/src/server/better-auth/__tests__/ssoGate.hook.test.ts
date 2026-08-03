import { beforeEach, describe, expect, it, vi } from "vitest";

// Stub the Prisma client so importing `../index` (which constructs a real
// `betterAuth({ database: prismaAdapter(prisma, ...) })`) doesn't instantiate
// a live PrismaClient — same reason `fallbackName.test.ts` mocks it. This
// file exercises only the `before`-hook's routing logic, no DB.
vi.mock("~/server/db", () => ({ prisma: {} }));

// The gate itself is unit-tested in `ee/sso/__tests__/sso-gate.test.ts`.
// This file tests ONLY the hook's orchestration: which paths get refused in
// which gate state, per ADR-027 Decision 4 / Constants table.
vi.mock("@ee/sso/sso-gate", () => ({
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
vi.mock("@langwatch/observability", () => ({
  createLogger: () => loggerMock,
}));

import { platformSSOAllowed, resolveAuthProvider } from "@ee/sso/sso-gate";
import { env } from "~/env.mjs";
import { auth } from "../index";

const envMock = env as unknown as { NEXTAUTH_PROVIDER: string };

// Named `runBeforeHook` rather than `before`: a bare `before` reads as a
// test lifecycle hook, both to a human and to biome's noDuplicateTestHooks.
const runBeforeHook = (auth as any).options.hooks.before as (ctx: {
  request?: { url: string };
}) => Promise<void>;

const ctxFor = (url: string) => ({ request: { url } });

describe("better-auth before-hook (ADR-027 gate sites #2 and #3)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    envMock.NEXTAUTH_PROVIDER = "auth0";
    // The everyday case: the configured provider is one this build mounts, so
    // the resolver hands back the configured id rather than coercing to email.
    vi.mocked(resolveAuthProvider).mockResolvedValue("auth0");
  });

  describe("given a plain email-mode deployment (not SSO-capable)", () => {
    beforeEach(() => {
      envMock.NEXTAUTH_PROVIDER = "email";
    });

    it("never evaluates the gate and leaves every path untouched", async () => {
      await expect(
        runBeforeHook(ctxFor("https://host/api/auth/sign-in/email")),
      ).resolves.toBeUndefined();
      await expect(
        runBeforeHook(ctxFor("https://host/api/auth/request-password-reset")),
      ).resolves.toBeUndefined();
      expect(platformSSOAllowed).not.toHaveBeenCalled();
    });
  });

  describe("given an SSO-capable deployment where the gate DENIES", () => {
    beforeEach(() => {
      vi.mocked(platformSSOAllowed).mockResolvedValue(false);
    });

    /** @scenario SSO sign-in routes are refused while the deployment is unlicensed */
    it("refuses SSO sign-in, link, and callback routes", async () => {
      await expect(
        runBeforeHook(ctxFor("https://host/api/auth/sign-in/social")),
      ).rejects.toMatchObject({ statusCode: 403 });
      await expect(
        runBeforeHook(ctxFor("https://host/api/auth/sign-in/oauth2")),
      ).rejects.toMatchObject({ statusCode: 403 });
      await expect(
        runBeforeHook(ctxFor("https://host/api/auth/link-social")),
      ).rejects.toMatchObject({ statusCode: 403 });
      await expect(
        runBeforeHook(ctxFor("https://host/api/auth/oauth2/link")),
      ).rejects.toMatchObject({ statusCode: 403 });
    });

    /** @scenario SSO sign-in routes are refused while the deployment is unlicensed */
    it("refuses trailing-slash and query-string variants of the initiation routes", async () => {
      await expect(
        runBeforeHook(ctxFor("https://host/api/auth/sign-in/social/")),
      ).rejects.toMatchObject({ statusCode: 403 });
      await expect(
        runBeforeHook(
          ctxFor("https://host/api/auth/sign-in/oauth2/?providerId=auth0"),
        ),
      ).rejects.toMatchObject({ statusCode: 403 });
    });

    /** @scenario Denied SSO is explained in the server logs */
    it("logs each refused SSO request with its path and reason", async () => {
      await expect(
        runBeforeHook(ctxFor("https://host/api/auth/sign-in/social")),
      ).rejects.toMatchObject({ statusCode: 403 });

      expect(loggerMock.warn).toHaveBeenCalledWith(
        expect.objectContaining({
          path: "/api/auth/sign-in/social",
          reason: "no_license",
        }),
        expect.any(String),
      );
    });

    /** @scenario SSO sign-in routes are refused while the deployment is unlicensed */
    it("refuses the legacy provider callback paths as well", async () => {
      await expect(
        runBeforeHook(
          ctxFor("https://host/api/auth/callback/auth0?code=abc&state=xyz"),
        ),
      ).rejects.toMatchObject({ statusCode: 403 });
      await expect(
        runBeforeHook(
          ctxFor("https://host/api/auth/callback/okta?code=abc&state=xyz"),
        ),
      ).rejects.toMatchObject({ statusCode: 403 });
      await expect(
        runBeforeHook(
          ctxFor(
            "https://host/api/auth/oauth2/callback/some-provider?code=abc",
          ),
        ),
      ).rejects.toMatchObject({ statusCode: 403 });
    });

    /** @scenario Existing users on an unlicensed deployment self-recover via password reset */
    it("leaves the password-reset pair open", async () => {
      await expect(
        runBeforeHook(ctxFor("https://host/api/auth/request-password-reset")),
      ).resolves.toBeUndefined();
      await expect(
        runBeforeHook(ctxFor("https://host/api/auth/reset-password?token=abc")),
      ).resolves.toBeUndefined();
    });

    /** @scenario A fresh unlicensed deployment bootstraps via email signup */
    it("leaves fresh email sign-up open", async () => {
      await expect(
        runBeforeHook(ctxFor("https://host/api/auth/sign-up/email")),
      ).resolves.toBeUndefined();
    });

    /** @scenario No password can be attached to an SSO account without inbox proof */
    it("still refuses credential-mutation endpoints", async () => {
      await expect(
        runBeforeHook(ctxFor("https://host/api/auth/set-password")),
      ).rejects.toMatchObject({ statusCode: 400 });
      await expect(
        runBeforeHook(ctxFor("https://host/api/auth/change-password")),
      ).rejects.toMatchObject({ statusCode: 400 });
    });

    it("does not interfere with unrelated requests", async () => {
      await expect(
        runBeforeHook(ctxFor("https://host/api/auth/get-session")),
      ).resolves.toBeUndefined();
    });
  });

  describe("given an SSO-capable deployment where the gate ALLOWS", () => {
    beforeEach(() => {
      vi.mocked(platformSSOAllowed).mockResolvedValue(true);
    });

    /** @scenario A licensed deployment cannot mint password accounts */
    /** @scenario A deployment that really does federate still refuses password accounts */
    it("refuses email sign-up, email sign-in, and password reset (v5 BLOCKER)", async () => {
      await expect(
        runBeforeHook(ctxFor("https://host/api/auth/sign-up/email")),
      ).rejects.toMatchObject({ statusCode: 400 });
      await expect(
        runBeforeHook(ctxFor("https://host/api/auth/sign-in/email")),
      ).rejects.toMatchObject({ statusCode: 400 });
      await expect(
        runBeforeHook(ctxFor("https://host/api/auth/request-password-reset")),
      ).rejects.toMatchObject({ statusCode: 400 });
      await expect(
        runBeforeHook(ctxFor("https://host/api/auth/reset-password?token=abc")),
      ).rejects.toMatchObject({ statusCode: 400 });
    });

    /** @scenario Self-hosted with a genuine org license keeps SSO working with zero action */
    it("leaves SSO sign-in routes open", async () => {
      await expect(
        runBeforeHook(ctxFor("https://host/api/auth/sign-in/social")),
      ).resolves.toBeUndefined();
      await expect(
        runBeforeHook(
          ctxFor("https://host/api/auth/callback/auth0?code=abc&state=xyz"),
        ),
      ).resolves.toBeUndefined();
    });

    /** @scenario No password can be attached to an SSO account without inbox proof */
    it("still refuses credential-mutation endpoints", async () => {
      await expect(
        runBeforeHook(ctxFor("https://host/api/auth/set-password")),
      ).rejects.toMatchObject({ statusCode: 400 });
      await expect(
        runBeforeHook(ctxFor("https://host/api/auth/verify-email")),
      ).rejects.toMatchObject({ statusCode: 400 });
    });

    /** @scenario A licensed deployment cannot mint password accounts */
    it("refuses trailing-slash variants — the router resolves them to the same handler", async () => {
      await expect(
        runBeforeHook(ctxFor("https://host/api/auth/sign-up/email/")),
      ).rejects.toMatchObject({ statusCode: 400 });
      await expect(
        runBeforeHook(ctxFor("https://host/api/auth/sign-in/email//")),
      ).rejects.toMatchObject({ statusCode: 400 });
      await expect(
        runBeforeHook(ctxFor("https://host/api/auth/set-password/")),
      ).rejects.toMatchObject({ statusCode: 400 });
    });

    it("does not interfere with unrelated requests", async () => {
      await expect(
        runBeforeHook(ctxFor("https://host/api/auth/get-session")),
      ).resolves.toBeUndefined();
    });
  });

  describe("given the gate allows but the configured provider never mounted", () => {
    beforeEach(() => {
      vi.mocked(platformSSOAllowed).mockResolvedValue(true);
      // What `resolveAuthProvider` reports when NEXTAUTH_PROVIDER names a
      // provider this build cannot wire up: the sign-in page renders the
      // credential form off exactly this answer.
      vi.mocked(resolveAuthProvider).mockResolvedValue("email");
    });

    /** @scenario The form a misconfigured deployment offers actually accepts a sign-in */
    it("accepts the email form it just offered, and the reset pair with it", async () => {
      // Without this the deployment is unusable: the page shows a password
      // form and every submit comes back "your account is managed by your
      // identity provider", naming one that does not exist.
      await expect(
        runBeforeHook(ctxFor("https://host/api/auth/sign-in/email")),
      ).resolves.toBeUndefined();
      await expect(
        runBeforeHook(ctxFor("https://host/api/auth/sign-up/email")),
      ).resolves.toBeUndefined();
      await expect(
        runBeforeHook(ctxFor("https://host/api/auth/request-password-reset")),
      ).resolves.toBeUndefined();
      await expect(
        runBeforeHook(ctxFor("https://host/api/auth/reset-password?token=abc")),
      ).resolves.toBeUndefined();
    });

    it("still refuses credential management, which no deployment state opens", async () => {
      // Opening the email form back up must not drag the credential-mutation
      // routes with it. `/set-password` is refused in every gate state and for
      // its own reason, not because the provider failed to mount.
      await expect(
        runBeforeHook(ctxFor("https://host/api/auth/set-password")),
      ).rejects.toMatchObject({ statusCode: 400 });
    });
  });

  describe("given a signed-in user when the gate state changes", () => {
    /** @scenario Existing sessions keep working across a gate change */
    it("never intercepts session reads or sign-out in either gate state", async () => {
      for (const allowed of [true, false]) {
        vi.mocked(platformSSOAllowed).mockResolvedValue(allowed);
        await expect(
          runBeforeHook(ctxFor("https://host/api/auth/get-session")),
        ).resolves.toBeUndefined();
        await expect(
          runBeforeHook(ctxFor("https://host/api/auth/sign-out")),
        ).resolves.toBeUndefined();
        await expect(
          runBeforeHook(ctxFor("https://host/api/auth/list-sessions")),
        ).resolves.toBeUndefined();
      }
    });

    /** @scenario A slow licensing store does not hold up signed-in users */
    it("answers session traffic without consulting the gate at all", async () => {
      // A gate that never settles: if the hook awaited it, these would hang
      // rather than resolve, which is precisely the availability failure a
      // mocked-resolved gate can never surface.
      vi.mocked(platformSSOAllowed).mockReturnValue(new Promise(() => {}));

      for (const path of [
        "/get-session",
        "/sign-out",
        "/list-sessions",
        "/revoke-session",
        "/update-user",
        "/list-accounts",
      ]) {
        await expect(
          runBeforeHook(ctxFor(`https://host/api/auth${path}`)),
        ).resolves.toBeUndefined();
      }

      expect(platformSSOAllowed).not.toHaveBeenCalled();
    });
  });
});
