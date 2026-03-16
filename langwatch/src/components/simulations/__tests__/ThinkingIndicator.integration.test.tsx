/**
 * @vitest-environment jsdom
 *
 * Integration tests for the ThinkingIndicator component.
 * Verifies the three-dot animated indicator renders correctly
 * with proper alignment and accessibility.
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { ThinkingIndicator } from "../ThinkingIndicator";

const Wrapper = ({ children }: { children: React.ReactNode }) => (
  <ChakraProvider value={defaultSystem}>{children}</ChakraProvider>
);

describe("<ThinkingIndicator/>", () => {
  afterEach(cleanup);

  describe("when rendered", () => {
    it("renders three dots", () => {
      render(<ThinkingIndicator />, { wrapper: Wrapper });

      const dots = screen.getAllByText("●");
      expect(dots).toHaveLength(3);
    });

    it("has an accessible status label", () => {
      render(<ThinkingIndicator />, { wrapper: Wrapper });

      expect(screen.getByRole("status")).toBeInTheDocument();
    });

    it("is left-aligned", () => {
      render(<ThinkingIndicator />, { wrapper: Wrapper });

      const container = screen.getByRole("status");
      expect(container).toHaveStyle({ "justify-content": "flex-start" });
    });
  });
});
