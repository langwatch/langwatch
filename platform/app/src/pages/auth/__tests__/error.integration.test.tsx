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
  let originalLocation: Location;
  let originalReferrer: string;
  let origin: string;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    sessionRef.current = { data: null };
    publicEnvRef.current = { NEXTAUTH_PROVIDER: "auth0" };
    searchParamsRef.current = new URLSearchParams("");

    originalLocation = window.location;
    originalReferrer = document.referrer;
    origin = originalLocation.origin;
    Object.defineProperty(window, "location", {
      value: { ...originalLocation, href: originalLocation.href },
      writable: true,
      configurable: true,
    });
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    Object.defineProperty(window, "location", {
      value: originalLocation,
      writable: true,
      configurable: true,
    });
    setReferrer(originalReferrer);
  });

  describe("given a same-origin referrer", () => {
    it("redirects back to the referrer after the countdown", async () => {
      setReferrer(`${origin}/some/prior/page`);
      render(<Error />);

      await vi.advanceTimersByTimeAsync(5000);

      expect(window.location.href).toBe(`${origin}/some/prior/page`);
    });
  });

  describe("given a cross-origin referrer that shares the origin as a prefix (@regression)", () => {
    it("falls back to / instead of following it off-domain", async () => {
      setReferrer(`${origin}.evil.com/phish`);
      render(<Error />);

      await vi.advanceTimersByTimeAsync(5000);

      expect(window.location.href).toBe("/");
    });
  });

  describe("given no referrer", () => {
    it("falls back to /", async () => {
      setReferrer("");
      render(<Error />);

      await vi.advanceTimersByTimeAsync(5000);

      expect(window.location.href).toBe("/");
    });
  });
});
