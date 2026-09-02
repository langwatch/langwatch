/**
 * @vitest-environment jsdom
 *
 * Unit tests for SearchInput component.
 *
 * @see specs/components/search-input.feature - "SearchInput forwards typed text"
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SearchInput } from "../src/components/search-input";

const Wrapper = ({ children }: { children: React.ReactNode }) => (
  <ChakraProvider value={defaultSystem}>{children}</ChakraProvider>
);

describe("<SearchInput/>", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  describe("when typing text into the input", () => {
    /** @scenario SearchInput forwards typed text to the onChange handler */
    it("forwards the value to the onChange callback", () => {
      const onChange = vi.fn();

      render(<SearchInput onChange={onChange} />, { wrapper: Wrapper });

      const input = screen.getByRole("searchbox");
      fireEvent.change(input, { target: { value: "billing" } });

      expect(onChange).toHaveBeenCalled();
      const lastCallEvent = onChange.mock.calls.at(-1)?.[0] as React.ChangeEvent<HTMLInputElement>;
      expect(lastCallEvent.target.value).toBe("billing");
    });
  });
});
