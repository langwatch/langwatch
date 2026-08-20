/**
 * @vitest-environment jsdom
 *
 * Integration coverage for the /auth/error referrer redirect on Auth0
 * deployments: an unrecoverable OAuth failure (no stable-error code) bounces
 * the user back to `document.referrer` after a 5s countdown, but only when
 * that referrer is same-origin — otherwise it falls back to "/". Exercises
 * the real `isSameOrigin` guard via `importOriginal`, not a reimplementation.
 */
import { cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { sessionRef, publicEnvRef, searchParamsRef } = vi.hoisted(() => ({
  sessionRef: { current: { data: null as unknown } },
  publicEnvRef: {
    current: { NEXTAUTH_PROVIDER: "auth0" as string | undefined },
  },
  searchParamsRef: { current: new URLSearchParams("") },
}));

vi.mock("~/utils/auth-client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("~/utils/auth-client")>();
  return {
    ...actual,
    useSession: () => sessionRef.current,
  };
});

// The page bounces the user out of the SPA after a delay, through the
// navigation seam. Asserting the call is the only way to see it: jsdom defines
// `window.location` as a non-configurable accessor, so the stand-in object this
// test used to install throws in a VM realm, and a real href assignment is a
// navigation jsdom does not implement and therefore never records.
const { hardNavigate } = vi.hoisted(() => ({ hardNavigate: vi.fn() }));

vi.mock("~/utils/browserNavigation", () => ({
  hardNavigate,
  replaceLocation: vi.fn(),
  reloadPage: vi.fn(),
}));

vi.mock("~/utils/compat/next-navigation", () => ({
  useSearchParams: () => searchParamsRef.current,
}));

vi.mock("~/hooks/usePublicEnv", () => ({
  usePublicEnv: () => ({ data: publicEnvRef.current }),
}));

import Error from "../error";

const setReferrer = (value: string) => {
  Object.defineProperty(document, "referrer", { value, configurable: true });
};

describe("Auth error page referrer redirect", () => {
  let originalReferrer: string;
  let origin: string;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    sessionRef.current = { data: null };
    publicEnvRef.current = { NEXTAUTH_PROVIDER: "auth0" };
    searchParamsRef.current = new URLSearchParams("");

    originalReferrer = document.referrer;
    origin = window.location.origin;
    hardNavigate.mockClear();
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    setReferrer(originalReferrer);
  });

  describe("given a same-origin referrer", () => {
    it("redirects back to the referrer after the countdown", async () => {
      setReferrer(`${origin}/some/prior/page`);
      render(<Error />);

      await vi.advanceTimersByTimeAsync(5000);

      expect(hardNavigate).toHaveBeenCalledWith(`${origin}/some/prior/page`);
    });
  });

  describe("given a cross-origin referrer that shares the origin as a prefix (@regression)", () => {
    it("falls back to / instead of following it off-domain", async () => {
      setReferrer(`${origin}.evil.com/phish`);
      render(<Error />);

      await vi.advanceTimersByTimeAsync(5000);

      expect(hardNavigate).toHaveBeenCalledWith("/");
    });
  });

  describe("given no referrer", () => {
    it("falls back to /", async () => {
      setReferrer("");
      render(<Error />);

      await vi.advanceTimersByTimeAsync(5000);

      expect(hardNavigate).toHaveBeenCalledWith("/");
    });
  });
});
