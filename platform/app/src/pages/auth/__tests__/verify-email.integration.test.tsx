/**
 * @vitest-environment jsdom
 *
 * The /auth/verify-email landing page renders under Chakra; only the URL
 * search-params hook is mocked. The page must never complete a verification
 * on its own — a scanner following the link sees exactly what a person does —
 * and it must never copy the link's proof into the DOM, where session-replay
 * and RUM collectors scrape attributes.
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { searchParamsRef, publicEnvRef } = vi.hoisted(() => ({
  searchParamsRef: {
    current: new URLSearchParams("") as URLSearchParams | null,
  },
  publicEnvRef: {
    current: { IS_SAAS: false } as Record<
      string,
      unknown
    >,
  },
}));

vi.mock("~/utils/compat/next-navigation", () => ({
  useSearchParams: () => searchParamsRef.current,
}));

// The landing composes the auth screens' ground now, so it asks the deployment
// which door it is before rendering either. Answered here rather than wrapped
// in a tRPC provider: what these tests are about is what the page does with
// the LINK, and standing a query client up around them would only add a way
// for them to fail for an unrelated reason.
vi.mock("~/hooks/usePublicEnv", () => ({
  usePublicEnv: () => ({ data: publicEnvRef.current }),
}));

import VerifyEmail from "../verify-email";

const renderPage = () =>
  render(
    <ChakraProvider value={defaultSystem}>
      <VerifyEmail />
    </ChakraProvider>,
  );

describe("the /auth/verify-email landing page", () => {
  const fetchSpy = vi.fn();

  beforeEach(() => {
    vi.stubGlobal("fetch", fetchSpy);
    searchParamsRef.current = new URLSearchParams("vid=ver_123&token=tok_abc");
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    fetchSpy.mockReset();
  });

  describe("when the emailed magic link is opened", () => {
    /** @scenario "Email verification completes only with the ceremony's proof" */
    it("renders the guidance, keeps the link's proof out of the DOM, and makes no request", () => {
      renderPage();

      expect(screen.getByText("Almost there")).toBeDefined();
      expect(
        screen.getByText(
          "Return to the window where you requested this verification to finish confirming your email address.",
        ),
      ).toBeDefined();
      const landing = screen.getByTestId("verify-email-landing");
      expect(landing.outerHTML).not.toContain("tok_abc");
      expect(landing.outerHTML).not.toContain("ver_123");
      expect(fetchSpy).not.toHaveBeenCalled();
    });
  });

  describe("when a link-scanning gateway prefetches the magic link", () => {
    /** @scenario "A mail scanner's prefetch cannot verify an identifier" */
    it("renders the same page however many times, and never calls the completion RPC", () => {
      for (let fetchCount = 0; fetchCount < 3; fetchCount += 1) {
        renderPage();
        cleanup();
      }

      expect(fetchSpy).not.toHaveBeenCalled();
    });
  });

  describe("when the link carries no proof at all", () => {
    /**
     * Changed deliberately, and it is the one behavioural change on this page.
     * It used to render the ordinary "go back to your other window" guidance,
     * which is useless advice for a link that arrived broken — the other
     * window cannot finish a ceremony whose token never made it here. It now
     * says the link is incomplete and what to do about it.
     *
     * What did NOT change is the thing the uniform rendering was protecting:
     * neither branch makes a request, so a scanner still learns nothing and
     * still consumes nothing. That is asserted below rather than assumed.
     */
    /** @scenario "An incomplete verification link says so, and still verifies nothing" */
    it("says the link is incomplete, and still makes no request", () => {
      searchParamsRef.current = new URLSearchParams("");

      renderPage();

      expect(screen.getByTestId("verify-email-incomplete")).toBeDefined();
      expect(screen.getByText("This link is incomplete")).toBeDefined();
      // The ordinary guidance is NOT what this state says: sending somebody
      // back to a window that cannot finish the job is the bug being fixed.
      expect(screen.queryByTestId("verify-email-landing")).toBeNull();
      expect(fetchSpy).not.toHaveBeenCalled();
    });
  });
});
