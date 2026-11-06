/**
 * @vitest-environment node
 * An SSO sign-in the engine refuses over its provider's discovery document is
 * logged with its reason, since the browser is the only other place it shows.
 */
import { APIError } from "better-auth/api";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { loggerMock } = vi.hoisted(() => ({
  loggerMock: { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

vi.mock("@langwatch/observability", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  createLogger: () => loggerMock,
}));

import { logSsoDiscoveryRefusal } from "../http.better-auth.channel.ts";

const UNTRUSTED =
  'Untrusted OIDC discovery URL: The token_endpoint "https://oauth2.googleapis.com/token" is not trusted by your trusted origins configuration.';

describe("logSsoDiscoveryRefusal", () => {
  beforeEach(() => {
    loggerMock.warn.mockClear();
    loggerMock.error.mockClear();
  });

  describe("when the SSO engine refuses an endpoint of the provider's discovery document", () => {
    it("warns with the refusal code and its reason", () => {
      logSsoDiscoveryRefusal({
        context: {
          returned: APIError.from("BAD_REQUEST", {
            code: "discovery_untrusted_origin",
            message: UNTRUSTED,
          }),
        },
      });

      expect(loggerMock.warn).toHaveBeenCalledWith(
        { code: "discovery_untrusted_origin", reason: UNTRUSTED },
        "an sso sign-in was refused",
      );
      expect(loggerMock.error).not.toHaveBeenCalled();
    });
  });

  describe("when an endpoint refuses for any other reason", () => {
    it("logs nothing", () => {
      logSsoDiscoveryRefusal({
        context: {
          returned: APIError.from("UNAUTHORIZED", {
            code: "INVALID_EMAIL_OR_PASSWORD",
            message: "Invalid email or password",
          }),
        },
      });

      expect(loggerMock.warn).not.toHaveBeenCalled();
      expect(loggerMock.error).not.toHaveBeenCalled();
    });
  });
});
