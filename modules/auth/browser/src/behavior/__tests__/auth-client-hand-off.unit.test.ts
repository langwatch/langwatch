/**
 * @vitest-environment jsdom
 * One provider hand-off per page: a second press cannot overwrite the state cookie the
 * provider's callback is checked against. Spec: modules/auth/specs/invited-new-account.feature
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const { socialSpy, ssoSpy, hardNavigateSpy } = vi.hoisted(() => ({
  socialSpy: vi.fn(),
  ssoSpy: vi.fn(),
  hardNavigateSpy: vi.fn(),
}));

vi.mock("better-auth/react", () => ({
  createAuthClient: () => ({
    signIn: { email: vi.fn(), social: socialSpy },
    $fetch: (path: string, init: { body: unknown }) =>
      path === "/sign-in/sso" ? ssoSpy(init.body) : Promise.resolve({ error: null, data: {} }),
  }),
}));

vi.mock("../browser-navigation.ts", () => ({
  hardNavigate: hardNavigateSpy,
  replaceLocation: vi.fn(),
  reloadPage: vi.fn(),
}));

import { resetSignInHandOff, signIn } from "../auth-client.tsx";

/** A start the server has not answered yet, released by the test. */
function pendingStart() {
  let answer: (value: unknown) => void = () => undefined;
  const started = new Promise((resolve) => {
    answer = resolve;
  });
  return { started, answer };
}

beforeEach(() => {
  vi.clearAllMocks();
  resetSignInHandOff();
});

describe("given a provider sign-in on its way to the provider", () => {
  describe("when the same page starts a provider sign-in again", () => {
    /** @scenario "A second press while a provider sign-in is starting joins the first" */
    it("starts nothing new and answers with the first one's result", async () => {
      const start = pendingStart();
      socialSpy.mockReturnValueOnce(start.started);

      const first = signIn("google", { callbackUrl: "/invite/accept?inviteCode=abc" });
      const second = signIn("google", { callbackUrl: "/invite/accept?inviteCode=abc" });
      start.answer({ error: null, data: { url: "https://accounts.example/authorize?state=a" } });

      expect(await first).toEqual({ ok: true });
      expect(await second).toEqual({ ok: true });
      // Still on its way: a third press after the answer joins it too.
      await signIn("google", {});
      expect(socialSpy).toHaveBeenCalledTimes(1);
      expect(hardNavigateSpy).toHaveBeenCalledTimes(1);
      expect(hardNavigateSpy).toHaveBeenCalledWith("https://accounts.example/authorize?state=a");
    });

    it("holds an organization's connection to the same rule", async () => {
      ssoSpy.mockResolvedValue({ error: null, data: { url: "https://idp.example/sso" } });

      await Promise.all([signIn("ssoc_2f8Qk3", {}), signIn("ssoc_2f8Qk3", {})]);

      expect(ssoSpy).toHaveBeenCalledTimes(1);
    });
  });
});

describe("given a provider sign-in whose start was refused", () => {
  describe("when the person presses the provider again", () => {
    /** @scenario "A provider sign-in that was refused can be started again" */
    it("starts a new sign-in", async () => {
      socialSpy
        .mockResolvedValueOnce({ error: { message: "nope", status: 403 }, data: null })
        .mockResolvedValueOnce({ error: null, data: {} });

      expect((await signIn("google", {}))?.ok).toBe(false);
      expect(await signIn("google", {})).toEqual({ ok: true });

      expect(socialSpy).toHaveBeenCalledTimes(2);
    });
  });
});

describe("given a provider sign-in started before the person went back", () => {
  describe("when the page is restored from the back-forward cache", () => {
    /** @scenario "A page restored from the back-forward cache can start a provider sign-in again" */
    it("starts a new sign-in on the next press", async () => {
      socialSpy.mockResolvedValue({ error: null, data: {} });
      await signIn("google", {});

      const restored = new Event("pageshow");
      Object.defineProperty(restored, "persisted", { value: true });
      window.dispatchEvent(restored);
      await signIn("google", {});

      expect(socialSpy).toHaveBeenCalledTimes(2);
    });
  });
});
