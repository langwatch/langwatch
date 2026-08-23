/**
 * @vitest-environment jsdom
 *
 * The /auth/verify-email landing page renders under Chakra; only the URL
 * search-params hook is mocked. The page must never complete a verification
 * on its own — a scanner following the link sees exactly what a person does.
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { searchParamsRef } = vi.hoisted(() => ({
  searchParamsRef: {
    current: new URLSearchParams("") as URLSearchParams | null,
  },
}));

vi.mock("~/utils/compat/next-navigation", () => ({
  useSearchParams: () => searchParamsRef.current,
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
    it("renders the guidance and carries the link's proof for the initiating window, making no request", () => {
      renderPage();

      expect(screen.getByText("Almost there")).toBeDefined();
      const landing = screen.getByTestId("verify-email-landing");
      expect(landing.getAttribute("data-verification-id")).toBe("ver_123");
      expect(landing.getAttribute("data-token")).toBe("tok_abc");
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
    it("still renders, with empty proof attributes", () => {
      searchParamsRef.current = new URLSearchParams("");

      renderPage();

      const landing = screen.getByTestId("verify-email-landing");
      expect(landing.getAttribute("data-verification-id")).toBe("");
      expect(landing.getAttribute("data-token")).toBe("");
    });
  });
});
