/**
 * @vitest-environment jsdom
 *
 * Integration tests for the scenario welcome components.
 *
 * Covers:
 * - Inline welcome screen renders content and triggers onProceed
 * - Modal renders content when open
 * - Modal does not render content when closed
 * - Welcome content (title, description, capabilities, CTA)
 * - Proceed button triggers onProceed callback
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ScenarioWelcomeModal, ScenarioWelcomeScreen } from "../ScenarioWelcomeScreen";

const Wrapper = ({ children }: { children: React.ReactNode }) => (
  <ChakraProvider value={defaultSystem}>{children}</ChakraProvider>
);

describe("<ScenarioWelcomeScreen/>", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("displays a title mentioning scenarios", () => {
    render(<ScenarioWelcomeScreen onProceed={vi.fn()} />, { wrapper: Wrapper });

    expect(screen.getByRole("heading")).toHaveTextContent(/scenario/i);
  });

  it("displays a description explaining scenarios test agent behavior", () => {
    render(<ScenarioWelcomeScreen onProceed={vi.fn()} />, { wrapper: Wrapper });

    expect(screen.getByText(/test your agent behavior/i)).toBeInTheDocument();
  });

  it("displays automated testing capability highlight", () => {
    render(<ScenarioWelcomeScreen onProceed={vi.fn()} />, { wrapper: Wrapper });

    expect(screen.getByText(/automated testing/i)).toBeInTheDocument();
  });

  it("displays regression detection capability highlight", () => {
    render(<ScenarioWelcomeScreen onProceed={vi.fn()} />, { wrapper: Wrapper });

    expect(screen.getByText(/regression detection/i)).toBeInTheDocument();
  });

  it("displays a primary call-to-action button", () => {
    render(<ScenarioWelcomeScreen onProceed={vi.fn()} />, { wrapper: Wrapper });

    expect(screen.getByRole("button", { name: /create your first scenario/i })).toBeInTheDocument();
  });

  describe("when user clicks the proceed button", () => {
    it("calls onProceed callback", () => {
      const onProceed = vi.fn();

      render(<ScenarioWelcomeScreen onProceed={onProceed} />, { wrapper: Wrapper });

      fireEvent.click(screen.getByRole("button", { name: /create your first scenario/i }));

      expect(onProceed).toHaveBeenCalledOnce();
    });
  });
});

describe("<ScenarioWelcomeModal/>", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  describe("when open", () => {
    it("displays a title mentioning scenarios", () => {
      render(
        <ScenarioWelcomeModal open={true} onOpenChange={vi.fn()} onProceed={vi.fn()} />,
        { wrapper: Wrapper }
      );

      expect(screen.getByRole("heading")).toHaveTextContent(/scenario/i);
    });

    it("displays a primary call-to-action button", () => {
      render(
        <ScenarioWelcomeModal open={true} onOpenChange={vi.fn()} onProceed={vi.fn()} />,
        { wrapper: Wrapper }
      );

      expect(screen.getByRole("button", { name: /create your first scenario/i })).toBeInTheDocument();
    });

    describe("when user clicks the proceed button", () => {
      it("calls onProceed callback", () => {
        const onProceed = vi.fn();

        render(
          <ScenarioWelcomeModal open={true} onOpenChange={vi.fn()} onProceed={onProceed} />,
          { wrapper: Wrapper }
        );

        fireEvent.click(screen.getByRole("button", { name: /create your first scenario/i }));

        expect(onProceed).toHaveBeenCalledOnce();
      });
    });
  });

  describe("when closed", () => {
    it("does not show an open dialog", () => {
      const { container } = render(
        <ScenarioWelcomeModal open={false} onOpenChange={vi.fn()} onProceed={vi.fn()} />,
        { wrapper: Wrapper }
      );

      const openDialogs = container.querySelectorAll('[data-state="open"][role="dialog"]');
      expect(openDialogs).toHaveLength(0);
    });
  });
});
