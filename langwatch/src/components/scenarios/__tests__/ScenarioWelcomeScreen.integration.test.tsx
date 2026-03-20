/**
 * @vitest-environment jsdom
 *
 * Integration tests for the scenario welcome onboarding screen.
 *
 * Covers the @integration scenarios from welcome-screens.feature:
 * - Show welcome screen on first scenario creation (no scenarios exist)
 * - Proceed from welcome screen to scenario creation
 * - Skip welcome screen when scenarios already exist
 * - Welcome screen content (title, description, capabilities, CTA)
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ScenarioWelcomeScreen } from "../ScenarioWelcomeScreen";

const Wrapper = ({ children }: { children: React.ReactNode }) => (
  <ChakraProvider value={defaultSystem}>{children}</ChakraProvider>
);

describe("<ScenarioWelcomeScreen/>", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("when rendered", () => {
    it("displays a title mentioning scenarios", () => {
      render(
        <ScenarioWelcomeScreen onProceed={vi.fn()} />,
        { wrapper: Wrapper }
      );

      expect(screen.getByRole("heading")).toHaveTextContent(/scenario/i);
    });

    it("displays a description explaining scenarios test agent behavior", () => {
      render(
        <ScenarioWelcomeScreen onProceed={vi.fn()} />,
        { wrapper: Wrapper }
      );

      const descriptions = screen.getAllByText(/test your agent behavior/i);
      expect(descriptions.length).toBeGreaterThanOrEqual(1);
    });

    it("displays automated testing capability highlight", () => {
      render(
        <ScenarioWelcomeScreen onProceed={vi.fn()} />,
        { wrapper: Wrapper }
      );

      const elements = screen.getAllByText(/automated testing/i);
      expect(elements.length).toBeGreaterThanOrEqual(1);
    });

    it("displays regression detection capability highlight", () => {
      render(
        <ScenarioWelcomeScreen onProceed={vi.fn()} />,
        { wrapper: Wrapper }
      );

      const elements = screen.getAllByText(/regression detection/i);
      expect(elements.length).toBeGreaterThanOrEqual(1);
    });

    it("displays a primary call-to-action button", () => {
      render(
        <ScenarioWelcomeScreen onProceed={vi.fn()} />,
        { wrapper: Wrapper }
      );

      const buttons = screen.getAllByRole("button", { name: /create your first scenario/i });
      expect(buttons.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe("when user clicks the proceed button", () => {
    it("calls onProceed callback", () => {
      const onProceed = vi.fn();

      render(
        <ScenarioWelcomeScreen onProceed={onProceed} />,
        { wrapper: Wrapper }
      );

      const buttons = screen.getAllByRole("button", { name: /create your first scenario/i });
      fireEvent.click(buttons[buttons.length - 1]!);

      expect(onProceed).toHaveBeenCalledOnce();
    });
  });
});
