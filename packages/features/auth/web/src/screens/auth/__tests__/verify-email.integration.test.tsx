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

const { searchParamsRef } = vi.hoisted(() => ({
  searchParamsRef: {
    current: new URLSearchParams("") as URLSearchParams | null,
  },
}));

vi.mock("../../../behavior/use-route", () => ({
  useSearchParams: () => searchParamsRef.current,
}));

import VerifyEmail from "../verify-email.screen";

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
    it("still renders the guidance", () => {
      searchParamsRef.current = new URLSearchParams("");

      renderPage();

      expect(screen.getByTestId("verify-email-landing")).toBeDefined();
      expect(
        screen.getByText("Opening this link on its own does not confirm anything."),
      ).toBeDefined();
    });
  });
});
