// @vitest-environment jsdom
/**
 * Spec: specs/auth/signin-callback-url-unsupported-characters.feature
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import { consumeStoredReturnTo } from "../auth-client.tsx";
import { signInMethodLinkingCapability } from "../sign-in-method-linking-capability.ts";

afterEach(() => {
  vi.unstubAllGlobals();
  window.history.replaceState(null, "", "/");
  window.sessionStorage.clear();
});

const sentCallbackUrl = async (): Promise<unknown> => {
  const fetchMock = vi.fn(
    async (_url: string, _init: RequestInit) =>
      new Response(JSON.stringify({ redirect: false }), { status: 200 }),
  );
  vi.stubGlobal("fetch", fetchMock);

  expect(await signInMethodLinkingCapability.link({ provider: "github" })).toEqual({ ok: true });

  const [url, init] = fetchMock.mock.calls[0] ?? [];
  expect(url).toBe("/api/auth/link-social");
  const sent = typeof init?.body === "string" ? init.body : "";
  const body = JSON.parse(sent) as { provider: string; callbackURL: unknown };
  expect(body.provider).toBe("github");
  return body.callbackURL;
};

describe("linking another sign-in method, as auth lends it", () => {
  describe("when the page address carries characters better-auth refuses", () => {
    /** @scenario "Linking a sign-in method from a page better-auth refuses resumes there" */
    it("hands /link-social the resume page and parks the page for it", async () => {
      window.history.replaceState(null, "", "/me/security?tab=methods#linked");

      expect(await sentCallbackUrl()).toBe("/auth/resume");
      expect(consumeStoredReturnTo()).toBe("/me/security?tab=methods#linked");
    });
  });

  describe("when the page address passes better-auth's check", () => {
    /** @scenario "Linking a sign-in method from a page better-auth accepts hands it over unchanged" */
    it("hands /link-social the page as it is and parks nothing", async () => {
      window.history.replaceState(null, "", "/me/security?tab=methods");

      expect(await sentCallbackUrl()).toBe("/me/security?tab=methods");
      expect(consumeStoredReturnTo()).toBe("/");
    });
  });
});
