/**
 * Integration tests for the scenario welcome components.
 * @vitest-environment jsdom
 */
import { renderWithDesignSystem } from "@langwatch/design-system/testing";
import { cleanup, fireEvent, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ScenarioWelcomeModal, ScenarioWelcomeScreen } from "../../scenario-welcome.tsx";

describe("<ScenarioWelcomeScreen/>", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  /** @scenario 'Scenario welcome screen content' */
  it("displays a title mentioning scenarios", () => {
    renderWithDesignSystem(<ScenarioWelcomeScreen onProceed={vi.fn()} />);

    expect(screen.getByRole("heading")).toHaveTextContent(/scenario/i);
  });

  it("displays a description explaining scenarios test agent behavior", () => {
    renderWithDesignSystem(<ScenarioWelcomeScreen onProceed={vi.fn()} />);

    expect(screen.getByText(/test your agent behavior/i)).toBeInTheDocument();
  });

  it("displays automated testing capability highlight", () => {
    renderWithDesignSystem(<ScenarioWelcomeScreen onProceed={vi.fn()} />);

    expect(screen.getByText(/automated testing/i)).toBeInTheDocument();
  });

  it("displays regression detection capability highlight", () => {
    renderWithDesignSystem(<ScenarioWelcomeScreen onProceed={vi.fn()} />);

    expect(screen.getByText(/regression detection/i)).toBeInTheDocument();
  });

  it("displays a primary call-to-action button", () => {
    renderWithDesignSystem(<ScenarioWelcomeScreen onProceed={vi.fn()} />);

    expect(screen.getByRole("button", { name: /create your first scenario/i })).toBeInTheDocument();
  });

  describe("when user clicks the proceed button", () => {
    it("calls onProceed callback", () => {
      const onProceed = vi.fn();

      renderWithDesignSystem(<ScenarioWelcomeScreen onProceed={onProceed} />);

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
      renderWithDesignSystem(
        <ScenarioWelcomeModal open={true} onOpenChange={vi.fn()} onProceed={vi.fn()} />,
      );

      expect(screen.getByRole("heading")).toHaveTextContent(/scenario/i);
    });

    it("displays a primary call-to-action button", () => {
      renderWithDesignSystem(
        <ScenarioWelcomeModal open={true} onOpenChange={vi.fn()} onProceed={vi.fn()} />,
      );

      expect(
        screen.getByRole("button", { name: /create your first scenario/i }),
      ).toBeInTheDocument();
    });

    describe("when user clicks the proceed button", () => {
      it("calls onProceed callback", () => {
        const onProceed = vi.fn();

        renderWithDesignSystem(
          <ScenarioWelcomeModal open={true} onOpenChange={vi.fn()} onProceed={onProceed} />,
        );

        fireEvent.click(screen.getByRole("button", { name: /create your first scenario/i }));

        expect(onProceed).toHaveBeenCalledOnce();
      });
    });
  });

  describe("when closed", () => {
    it("does not show an open dialog", () => {
      const { container } = renderWithDesignSystem(
        <ScenarioWelcomeModal open={false} onOpenChange={vi.fn()} onProceed={vi.fn()} />,
      );

      const openDialogs = container.querySelectorAll('[data-state="open"][role="dialog"]');
      expect(openDialogs).toHaveLength(0);
    });
  });
});
