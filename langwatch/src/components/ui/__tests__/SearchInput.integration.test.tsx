/**
 * @vitest-environment jsdom
 *
 * Integration tests for SearchInput component.
 *
 * @see specs/components/search-input.feature - "SearchInput renders with a search icon and placeholder"
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SearchInput } from "../SearchInput";

const Wrapper = ({ children }: { children: React.ReactNode }) => (
  <ChakraProvider value={defaultSystem}>{children}</ChakraProvider>
);

describe("<SearchInput/>", () => {
  afterEach(() => {
    cleanup();
  });

  describe("when mounted with a placeholder", () => {
    beforeEach(() => {
      render(<SearchInput placeholder="Search suites..." />, {
        wrapper: Wrapper,
      });
    });

    it("renders a search icon inside the input", () => {
      expect(
        screen.getByRole("img", { name: "Search" }),
      ).toBeInTheDocument();
    });

    it("displays the placeholder text", () => {
      expect(
        screen.getByPlaceholderText("Search suites..."),
      ).toBeInTheDocument();
    });

    it("renders the input with searchbox role", () => {
      expect(screen.getByRole("searchbox")).toBeInTheDocument();
    });
  });
});
