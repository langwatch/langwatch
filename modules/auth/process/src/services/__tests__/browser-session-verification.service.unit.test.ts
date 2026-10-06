/**
 * @vitest-environment node
 * Who a browser request is at the API door, and what the refusals leave in the log.
 * @see specs/server/api-process-auth.feature
 */
import type { AuthApi } from "@langwatch/auth-contract";
import type * as observabilityModule from "@langwatch/observability";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { BrowserSessionVerificationService } from "../browser-session-verification.service.ts";

const loggerSpies = vi.hoisted(() => ({
  warn: vi.fn(),
  info: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
}));
vi.mock("@langwatch/observability", async (importOriginal) => ({
  ...(await importOriginal<typeof observabilityModule>()),
  createLogger: () => loggerSpies,
}));

const COOKIE_NAME = "better-auth.session_token";
const COOKIE_VALUE = "secret-token-value.sig";

function serviceOver({
  verifyBrowserSession,
  resolveBrowserSession = async () => ({ kind: "anonymous" }),
}: Pick<AuthApi, "verifyBrowserSession"> & Partial<Pick<AuthApi, "resolveBrowserSession">>) {
  return BrowserSessionVerificationService.create({
    sessions: createApiFixture<AuthApi>({ verifyBrowserSession, resolveBrowserSession }),
  });
}

const verifiedSession = async () =>
  ({
    kind: "verified",
    verified: { session: { id: "session-sam" }, user: { id: "user-sam" } },
  }) as Awaited<ReturnType<AuthApi["verifyBrowserSession"]>>;

function requestCarrying(cookie?: string): Request {
  return new Request("https://app.test/api/anything", {
    headers: cookie ? { cookie } : {},
  });
}

beforeEach(() => {
  Object.values(loggerSpies).forEach((spy) => spy.mockClear());
});

describe("given a request carrying a Better Auth session token", () => {
  describe("when the transport resolves no verified session for it", () => {
    /** @scenario A session token Better Auth rejects is logged as a refusal */
    it("is anonymous, and the refusal names the cookie but never its value", async () => {
      const service = serviceOver({ verifyBrowserSession: async () => ({ kind: "anonymous" }) });

      await expect(
        service.verify(requestCarrying(`${COOKIE_NAME}=${COOKIE_VALUE}`)),
      ).resolves.toEqual({ kind: "anonymous" });

      expect(loggerSpies.warn).toHaveBeenCalledTimes(1);
      const [fields] = loggerSpies.warn.mock.calls[0] as [Record<string, unknown>, string];
      expect(fields).toEqual({ cookies: [COOKIE_NAME] });
      expect(JSON.stringify(loggerSpies.warn.mock.calls)).not.toContain(COOKIE_VALUE);
    });
  });

  describe("when the lookup itself fails", () => {
    /** @scenario A transport that throws still leaves the caller anonymous */
    it("is anonymous, and the failure is logged as an error", async () => {
      const service = serviceOver({
        verifyBrowserSession: async () => {
          throw new Error("store down");
        },
      });

      await expect(
        service.verify(requestCarrying(`${COOKIE_NAME}=${COOKIE_VALUE}`)),
      ).resolves.toEqual({ kind: "anonymous" });

      expect(loggerSpies.error).toHaveBeenCalledTimes(1);
      expect(loggerSpies.warn).not.toHaveBeenCalled();
    });
  });
});

describe("given a session token Better Auth verifies", () => {
  describe("when the Auth service finds no live session behind it", () => {
    /** @scenario A verified session the Auth service cannot resolve is logged */
    it("is anonymous, and the unresolved session is logged with its identifiers", async () => {
      const service = serviceOver({ verifyBrowserSession: verifiedSession });

      await expect(
        service.verify(requestCarrying(`${COOKIE_NAME}=${COOKIE_VALUE}`)),
      ).resolves.toEqual({ kind: "anonymous" });

      expect(loggerSpies.warn).toHaveBeenCalledTimes(1);
      const [fields] = loggerSpies.warn.mock.calls[0] as [Record<string, unknown>, string];
      expect(fields).toEqual({ sessionId: "session-sam", userId: "user-sam" });
    });
  });

  describe("when the Auth service throws resolving it", () => {
    /** @scenario An Auth service that throws still leaves the caller anonymous */
    it("is anonymous, and the failure is logged as an error", async () => {
      const service = serviceOver({
        verifyBrowserSession: verifiedSession,
        resolveBrowserSession: async () => {
          throw new Error("read fork down");
        },
      });

      await expect(
        service.verify(requestCarrying(`${COOKIE_NAME}=${COOKIE_VALUE}`)),
      ).resolves.toEqual({ kind: "anonymous" });

      expect(loggerSpies.error).toHaveBeenCalledTimes(1);
    });
  });
});

describe("given a request carrying no session cookie", () => {
  describe("when the transport resolves no verified session", () => {
    /** @scenario An anonymous request is not logged as a refusal */
    it("is anonymous and logs nothing", async () => {
      const service = serviceOver({ verifyBrowserSession: async () => ({ kind: "anonymous" }) });

      await expect(service.verify(requestCarrying())).resolves.toEqual({ kind: "anonymous" });

      expect(loggerSpies.warn).not.toHaveBeenCalled();
      expect(loggerSpies.error).not.toHaveBeenCalled();
      expect(loggerSpies.info).not.toHaveBeenCalled();
    });
  });
});
