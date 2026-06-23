// @vitest-environment jsdom
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("react-router", () => ({
  useRouteError: vi.fn(),
}));

vi.mock("~/components/ui/link", () => ({
  Link: ({ href, children }: { href: string; children: ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));

import { useRouteError } from "react-router";
import NotFoundOrErrorPage from "../_not-found";

function Wrapper({ children }: { children: ReactNode }) {
  return <ChakraProvider value={defaultSystem}>{children}</ChakraProvider>;
}

const mockedUseRouteError = vi.mocked(useRouteError);

describe("NotFoundOrErrorPage", () => {
  beforeEach(() => {
    sessionStorage.clear();
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  describe("when the error is a chunk load failure", () => {
    beforeEach(() => {
      mockedUseRouteError.mockReturnValue(
        new Error(
          "Failed to fetch dynamically imported module: https://app.langwatch.ai/assets/messages-DNgD42jM.js",
        ),
      );
    });

    it("renders the chunk-specific title and hint", () => {
      render(<NotFoundOrErrorPage />, { wrapper: Wrapper });

      expect(screen.getByText("Failed to load page")).toBeDefined();
      expect(
        screen.getByText(/browser extension or network issue may be blocking/),
      ).toBeDefined();
    });

    it("renders a Reload app button", () => {
      render(<NotFoundOrErrorPage />, { wrapper: Wrapper });

      expect(screen.getByRole("button", { name: /Reload app/ })).toBeDefined();
    });

    it("reloads on click without error", () => {
      render(<NotFoundOrErrorPage />, { wrapper: Wrapper });

      expect(() =>
        fireEvent.click(screen.getByRole("button", { name: /Reload app/ })),
      ).not.toThrow();
    });
  });

  describe("when the error is a generic runtime error", () => {
    beforeEach(() => {
      mockedUseRouteError.mockReturnValue(
        new Error("Cannot read properties of undefined"),
      );
    });

    it("renders the generic error title without the reload button", () => {
      render(<NotFoundOrErrorPage />, { wrapper: Wrapper });

      expect(screen.getByText("Something went wrong")).toBeDefined();
      expect(screen.queryByRole("button", { name: /Reload app/ })).toBeNull();
    });
  });

  describe("when there is no error (404)", () => {
    beforeEach(() => {
      mockedUseRouteError.mockReturnValue(undefined);
    });

    it("renders the not-found page without the reload button", () => {
      render(<NotFoundOrErrorPage />, { wrapper: Wrapper });

      expect(screen.getByText("Page not found")).toBeDefined();
      expect(screen.queryByRole("button", { name: /Reload app/ })).toBeNull();
    });
  });
});
