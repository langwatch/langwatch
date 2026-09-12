/**
 * @vitest-environment jsdom
 *
 * Integration coverage for the /auth/error referrer redirect on Auth0
 * deployments: an unrecoverable OAuth failure (no stable-error code) bounces
 * the user back to `document.referrer` after a 5s countdown, but only when
 * that referrer is same-origin — otherwise it falls back to "/". Exercises
 * the real `isSameOrigin` guard via `importOriginal`, not a reimplementation.
 *
 * The stable failures are the other half: an arrival the next attempt would
 * only repeat must NOT be bounced anywhere, because the identity provider
 * still holds the session that produced it (specs/auth/sso-wrong-provider-
 * recovery.feature).
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen } from "@testing-library/react";
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
      render(
        <ChakraProvider value={defaultSystem}>
          <Error />
        </ChakraProvider>,
      );

      await vi.advanceTimersByTimeAsync(5000);

      expect(hardNavigate).toHaveBeenCalledWith(`${origin}/some/prior/page`);
    });
  });

  describe("given a cross-origin referrer that shares the origin as a prefix (@regression)", () => {
    it("falls back to / instead of following it off-domain", async () => {
      setReferrer(`${origin}.evil.com/phish`);
      render(
        <ChakraProvider value={defaultSystem}>
          <Error />
        </ChakraProvider>,
      );

      await vi.advanceTimersByTimeAsync(5000);

      expect(hardNavigate).toHaveBeenCalledWith("/");
    });
  });

  describe("given no referrer", () => {
    it("falls back to /", async () => {
      setReferrer("");
      render(
        <ChakraProvider value={defaultSystem}>
          <Error />
        </ChakraProvider>,
      );

      await vi.advanceTimersByTimeAsync(5000);

      expect(hardNavigate).toHaveBeenCalledWith("/");
    });
  });

  describe("given the account already exists under another sign-in method", () => {
    /** @scenario The error page does not auto-redirect back to the identity provider */
    it("stays on the page past the countdown, with the referrer pointing at the provider", async () => {
      // Arriving from the identity provider is exactly when a bounce would
      // re-run the same sign-in with the same live session.
      setReferrer(`${origin}/api/auth/callback/okta`);
      searchParamsRef.current = new URLSearchParams(
        "error=OAuthAccountNotLinked",
      );
      render(
        <ChakraProvider value={defaultSystem}>
          <Error />
        </ChakraProvider>,
      );

      await vi.advanceTimersByTimeAsync(10_000);

      expect(hardNavigate).not.toHaveBeenCalled();
      expect(screen.getByText("Account already exists")).toBeInTheDocument();
    });
  });

  describe("given the provider's only live session is one that cannot sign in", () => {
    /** @scenario A blocked returning user is not trapped bouncing between the app and the IdP */
    it("rests on a stable page that offers the way out, instead of bouncing", async () => {
      setReferrer(`${origin}/api/auth/callback/okta`);
      searchParamsRef.current = new URLSearchParams(
        "error=SSO_PROVIDER_NOT_ALLOWED",
      );
      render(
        <ChakraProvider value={defaultSystem}>
          <Error />
        </ChakraProvider>,
      );

      await vi.advanceTimersByTimeAsync(10_000);

      expect(hardNavigate).not.toHaveBeenCalled();
      // The recovery clears the provider's session too, which is what breaks
      // the loop on the next attempt.
      expect(
        screen.getByRole("link", { name: /sign out.*try again/i }),
      ).toHaveAttribute("href", "/api/auth/logout");
    });
  });
});
