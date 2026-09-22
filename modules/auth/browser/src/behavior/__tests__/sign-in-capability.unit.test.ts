/**
 * @vitest-environment node
 */
import { describe, expect, it, vi } from "vitest";

import { createSignInCapability } from "../sign-in-capability.ts";

const capability = (
  answer: {
    data?: { url?: string } | null;
    error?: { code?: string; message?: string; status?: number } | null;
  },
  href = "https://app.test/settings/sso?error=old&error_description=stale",
) => {
  const navigate = vi.fn();
  const startSsoSignIn = vi.fn().mockResolvedValue(answer);

  return {
    navigate,
    startSsoSignIn,
    subject: createSignInCapability({
      startSsoSignIn,
      navigate,
      currentHref: () => href,
    }),
  };
};

describe("the sign-in capability auth publishes", () => {
  describe("when a connection's test sign-in starts", () => {
    it("names the connection and returns to the page that asked, carrying that page's query", async () => {
      const { subject, startSsoSignIn } = capability({
        data: { url: "https://idp.test/authorize" },
      });

      await subject.testSignIn({
        connectionId: "conn_1",
        callbackQuery: { ssoTest: "conn_1", tab: "single-sign-on" },
      });

      expect(startSsoSignIn).toHaveBeenCalledWith({
        providerId: "conn_1",
        callbackURL: "https://app.test/settings/sso?ssoTest=conn_1&tab=single-sign-on",
      });
    });

    it("leaves for the provider's address", async () => {
      const { subject, navigate } = capability({ data: { url: "https://idp.test/authorize" } });

      const result = await subject.testSignIn({ connectionId: "conn_1", callbackQuery: {} });

      expect(navigate).toHaveBeenCalledWith("https://idp.test/authorize");
      expect(result.error).toBeNull();
    });
  });

  describe("when starting it is refused", () => {
    it("hands the refusal back and goes nowhere", async () => {
      const { subject, navigate } = capability({
        error: { code: "SSO_PROVIDER_NOT_FOUND", message: "no such provider", status: 404 },
      });

      const result = await subject.testSignIn({ connectionId: "conn_1", callbackQuery: {} });

      expect(result.error).toEqual({
        code: "SSO_PROVIDER_NOT_FOUND",
        message: "no such provider",
        status: 404,
      });
      expect(navigate).not.toHaveBeenCalled();
    });
  });

  describe("when the answer names no address", () => {
    it("stays where it is rather than navigating to nothing", async () => {
      const { subject, navigate } = capability({ data: {} });

      const result = await subject.testSignIn({ connectionId: "conn_1", callbackQuery: {} });

      expect(navigate).not.toHaveBeenCalled();
      expect(result.error).toBeNull();
    });
  });

  describe("spelling a sign-in code", () => {
    it("folds better-auth's link-account codes onto the one the screens read", () => {
      const { subject } = capability({ data: {} });

      expect(subject.normalizeSignInErrorCode("account_not_linked")).toBe("OAuthAccountNotLinked");
    });

    it("leaves a code it has nothing to say about alone", () => {
      const { subject } = capability({ data: {} });

      expect(subject.normalizeSignInErrorCode("sso_setup_address_mismatch")).toBe(
        "sso_setup_address_mismatch",
      );
    });
  });
});
