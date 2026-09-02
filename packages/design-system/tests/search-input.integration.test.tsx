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
import { SearchInput } from "../src/components/search-input";

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

    /** @scenario SearchInput renders with a search icon and placeholder */
    /** @scenario Scenario picker search field displays a search icon */
    /** @scenario Target picker search field displays a search icon */
    it("renders a search icon inside the input", () => {
      // The icon is DECORATIVE and carries `aria-hidden`, which is why it is
      // found in the DOM rather than by role: the accessible name lives on the
      // input itself, so a screen reader announces the field once instead of
      // announcing an image beside it.
      const { container } = render(<SearchInput placeholder="Search suites..." />, {
        wrapper: Wrapper,
      });
      expect(container.querySelector("svg[aria-hidden='true']")).toBeTruthy();
    });

    it("gives the input the accessible name a search field needs", () => {
      expect(screen.getAllByRole("searchbox")[0]?.getAttribute("aria-label")).toBe("Search");
    });

    it("displays the placeholder text", () => {
      expect(screen.getByPlaceholderText("Search suites...")).toBeTruthy();
    });

    it("renders the input with searchbox role", () => {
      expect(screen.getByRole("searchbox")).toBeTruthy();
    });
  });
});
