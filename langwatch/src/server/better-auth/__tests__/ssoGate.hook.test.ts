import { beforeEach, describe, expect, it, vi } from "vitest";

// The gate itself is unit-tested in `src/server/sso/__tests__/sso-gate.test.ts`.
// This file tests ONLY the hook's orchestration: which paths get refused in
// which gate state, per ADR-027 Decision 4 / Constants table.
vi.mock("../../sso/sso-gate", () => ({
  platformSSOAllowed: vi.fn(),
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
vi.mock("../../../utils/logger/server", () => ({
  createLogger: () => loggerMock,
}));

import { env } from "~/env.mjs";
import { platformSSOAllowed } from "../../sso/sso-gate";
import { auth } from "../index";

const envMock = env as unknown as { NEXTAUTH_PROVIDER: string };

const before = (auth as any).options.hooks.before as (ctx: {
  request?: { url: string };
}) => Promise<void>;

const ctxFor = (url: string) => ({ request: { url } });

describe("better-auth before-hook (ADR-027 gate sites #2 and #3)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    envMock.NEXTAUTH_PROVIDER = "auth0";
  });

  describe("given a plain email-mode deployment (not SSO-capable)", () => {
    beforeEach(() => {
      envMock.NEXTAUTH_PROVIDER = "email";
    });

    it("never evaluates the gate and leaves every path untouched", async () => {
      await expect(
        before(ctxFor("https://host/api/auth/sign-in/email")),
      ).resolves.toBeUndefined();
      await expect(
        before(ctxFor("https://host/api/auth/request-password-reset")),
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
        before(ctxFor("https://host/api/auth/sign-in/social")),
      ).rejects.toMatchObject({ statusCode: 403 });
      await expect(
        before(ctxFor("https://host/api/auth/sign-in/oauth2")),
      ).rejects.toMatchObject({ statusCode: 403 });
      await expect(
        before(ctxFor("https://host/api/auth/link-social")),
      ).rejects.toMatchObject({ statusCode: 403 });
      await expect(
        before(ctxFor("https://host/api/auth/oauth2/link")),
      ).rejects.toMatchObject({ statusCode: 403 });
    });

    /** @scenario Denied SSO is explained in the server logs */
    it("logs each refused SSO request with its path and reason", async () => {
      await expect(
        before(ctxFor("https://host/api/auth/sign-in/social")),
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
        before(
          ctxFor("https://host/api/auth/callback/auth0?code=abc&state=xyz"),
        ),
      ).rejects.toMatchObject({ statusCode: 403 });
      await expect(
        before(
          ctxFor("https://host/api/auth/callback/okta?code=abc&state=xyz"),
        ),
      ).rejects.toMatchObject({ statusCode: 403 });
      await expect(
        before(
          ctxFor(
            "https://host/api/auth/oauth2/callback/some-provider?code=abc",
          ),
        ),
      ).rejects.toMatchObject({ statusCode: 403 });
    });

    /** @scenario Existing users on an unlicensed deployment self-recover via password reset */
    it("leaves the password-reset pair open", async () => {
      await expect(
        before(ctxFor("https://host/api/auth/request-password-reset")),
      ).resolves.toBeUndefined();
      await expect(
        before(ctxFor("https://host/api/auth/reset-password?token=abc")),
      ).resolves.toBeUndefined();
    });

    /** @scenario A fresh unlicensed deployment bootstraps via email signup */
    it("leaves fresh email sign-up open", async () => {
      await expect(
        before(ctxFor("https://host/api/auth/sign-up/email")),
      ).resolves.toBeUndefined();
    });

    /** @scenario No password can be attached to an SSO account without inbox proof */
    it("still refuses credential-mutation endpoints", async () => {
      await expect(
        before(ctxFor("https://host/api/auth/set-password")),
      ).rejects.toMatchObject({ statusCode: 400 });
      await expect(
        before(ctxFor("https://host/api/auth/change-password")),
      ).rejects.toMatchObject({ statusCode: 400 });
    });

    it("does not interfere with unrelated requests", async () => {
      await expect(
        before(ctxFor("https://host/api/auth/get-session")),
      ).resolves.toBeUndefined();
    });
  });

  describe("given an SSO-capable deployment where the gate ALLOWS", () => {
    beforeEach(() => {
      vi.mocked(platformSSOAllowed).mockResolvedValue(true);
    });

    /** @scenario A licensed deployment cannot mint password accounts */
    it("refuses email sign-up, email sign-in, and password reset (v5 BLOCKER)", async () => {
      await expect(
        before(ctxFor("https://host/api/auth/sign-up/email")),
      ).rejects.toMatchObject({ statusCode: 400 });
      await expect(
        before(ctxFor("https://host/api/auth/sign-in/email")),
      ).rejects.toMatchObject({ statusCode: 400 });
      await expect(
        before(ctxFor("https://host/api/auth/request-password-reset")),
      ).rejects.toMatchObject({ statusCode: 400 });
      await expect(
        before(ctxFor("https://host/api/auth/reset-password?token=abc")),
      ).rejects.toMatchObject({ statusCode: 400 });
    });

    /** @scenario Self-hosted with a genuine org license keeps SSO working with zero action */
    it("leaves SSO sign-in routes open", async () => {
      await expect(
        before(ctxFor("https://host/api/auth/sign-in/social")),
      ).resolves.toBeUndefined();
      await expect(
        before(
          ctxFor("https://host/api/auth/callback/auth0?code=abc&state=xyz"),
        ),
      ).resolves.toBeUndefined();
    });

    /** @scenario No password can be attached to an SSO account without inbox proof */
    it("still refuses credential-mutation endpoints", async () => {
      await expect(
        before(ctxFor("https://host/api/auth/set-password")),
      ).rejects.toMatchObject({ statusCode: 400 });
      await expect(
        before(ctxFor("https://host/api/auth/verify-email")),
      ).rejects.toMatchObject({ statusCode: 400 });
    });

    it("does not interfere with unrelated requests", async () => {
      await expect(
        before(ctxFor("https://host/api/auth/get-session")),
      ).resolves.toBeUndefined();
    });
  });
});
