/**
 * @vitest-environment jsdom
 */
import "@testing-library/jest-dom/vitest";
import { renderWithDesignSystem } from "@langwatch/design-system/testing";
import { cleanup, fireEvent, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AutomationTestFireButton as TestFireButton } from "../ui/elements/test-fire-button.tsx";

describe("TestFireButton", () => {
  afterEach(() => {
    cleanup();
  });

  describe("given no test-fire handler", () => {
    it("renders nothing", () => {
      const { container } = renderWithDesignSystem(<TestFireButton />);
      expect(container).toBeEmptyDOMElement();
    });
  });

  describe("given a test-fire handler", () => {
    it("states plainly that it delivers a real message with example data", () => {
      renderWithDesignSystem(<TestFireButton onTestFire={vi.fn()} />);

      expect(
        screen.getByText(/delivers a real message to this destination, using example data/i),
      ).toBeInTheDocument();
    });

    it("fires the handler when clicked", () => {
      const onTestFire = vi.fn();
      renderWithDesignSystem(<TestFireButton onTestFire={onTestFire} />);

      fireEvent.click(screen.getByRole("button", { name: /send a test/i }));

      expect(onTestFire).toHaveBeenCalledTimes(1);
    });

    it("shows the disabled hint instead of firing when incomplete", () => {
      const onTestFire = vi.fn();
      renderWithDesignSystem(
        <TestFireButton onTestFire={onTestFire} disabled hint="Add a webhook URL first" />,
      );

      expect(screen.getByText("Add a webhook URL first")).toBeInTheDocument();
      const button = screen.getByRole("button", { name: /send a test/i });
      expect(button).toBeDisabled();
      // Exercised, not just attribute-checked: a click on the disabled
      // control must not fire.
      fireEvent.click(button);
      expect(onTestFire).not.toHaveBeenCalled();
    });
  });
});
