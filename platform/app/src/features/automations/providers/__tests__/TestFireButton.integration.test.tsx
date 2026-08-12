/**
 * @vitest-environment jsdom
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TestFireButton } from "../TestFireButton";

const Wrapper = ({ children }: { children: React.ReactNode }) => (
  <ChakraProvider value={defaultSystem}>{children}</ChakraProvider>
);

describe("TestFireButton", () => {
  afterEach(() => {
    cleanup();
  });

  describe("given no test-fire handler", () => {
    it("renders nothing", () => {
      const { container } = render(<TestFireButton />, { wrapper: Wrapper });
      expect(container).toBeEmptyDOMElement();
    });
  });

  describe("given a test-fire handler", () => {
    it("states plainly that it delivers a real message with example data", () => {
      render(<TestFireButton onTestFire={vi.fn()} />, { wrapper: Wrapper });

      expect(
        screen.getByText(
          /delivers a real message to this destination, using example data/i,
        ),
      ).toBeInTheDocument();
    });

    it("fires the handler when clicked", () => {
      const onTestFire = vi.fn();
      render(<TestFireButton onTestFire={onTestFire} />, { wrapper: Wrapper });

      fireEvent.click(screen.getByRole("button", { name: /send a test/i }));

      expect(onTestFire).toHaveBeenCalledTimes(1);
    });

    it("shows the disabled hint instead of firing when incomplete", () => {
      const onTestFire = vi.fn();
      render(
        <TestFireButton
          onTestFire={onTestFire}
          disabled
          hint="Add a webhook URL first"
        />,
        { wrapper: Wrapper },
      );

      expect(screen.getByText("Add a webhook URL first")).toBeInTheDocument();
      expect(
        screen.getByRole("button", { name: /send a test/i }),
      ).toBeDisabled();
    });
  });
});
