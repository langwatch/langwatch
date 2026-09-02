/**
 * @vitest-environment jsdom
 *
 * Integration tests for the FloatingAiBar's own error surface.
 *
 * Feature: specs/traces-v2/search.feature — "Provider error is visible
 * while the FloatingAiBar is open". The floating overlay covers the
 * docked search bar's unified banner, so a failure that only renders
 * there is invisible exactly when the user is looking for it.
 */

import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { act, cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";

vi.mock("@paper-design/shaders-react", () => ({
  MeshGradient: () => null,
}));

// The composer inside the bar dispatches through tRPC; these tests pin
// the ERROR SURFACE (store -> row), so the dispatcher is stubbed out.
vi.mock("../../ai/useAiTraceAction", () => ({
  useAiTraceAction: () => ({
    submit: vi.fn(),
    isPending: false,
    error: null,
    clearError: vi.fn(),
  }),
}));

import { explainAnyError } from "../../../../features/errors";
import type { AiActionError } from "@langwatch/trace-contract";
import { useFilterStore } from "../../../../index";
import { FloatingAiBar } from "../FloatingAiBar";

/** A handled failure in the shape tRPC delivers it. */
function handledCause(code: string, meta: Record<string, unknown> = {}) {
  return {
    data: {
      error: { code, httpStatus: 502, fault: "provider", meta, reasons: [] },
    },
  };
}

/** The words the code-keyed registry has for a failure. */
function registryTitle(cause: unknown): string {
  return explainAnyError(cause).title;
}

afterEach(() => {
  cleanup();
  useFilterStore.getState().setAiError(null);
});

beforeEach(() => {
  useFilterStore.getState().setAiError(null);
});

const RECT = { top: 100, left: 100, width: 600 };

function renderBar() {
  return render(
    <ChakraProvider value={defaultSystem}>
      <FloatingAiBar rect={RECT} onClose={vi.fn()} />
    </ChakraProvider>,
  );
}

describe("<FloatingAiBar /> error row", () => {
  describe("given no AI error in the store", () => {
    it("shows the rotating tip, not an alert", () => {
      renderBar();
      expect(screen.queryByRole("alert")).not.toBeInTheDocument();
      expect(screen.getByText(/save the result as a lens/i)).toBeInTheDocument();
    });
  });

  describe("given a provider error in the store", () => {
    const details = {
      provider: "azure",
      model: "azure/gpt-5.4-mini",
      httpStatus: 404,
    };
    const providerError: AiActionError = {
      code: "ai_query_provider_error",
      cause: handledCause("ai_query_provider_error", details),
      details,
    };

    // Set AFTER render: the composer's mount effect syncs its (stubbed,
    // null) hook error into the store, so a pre-set value would be wiped
    // on mount — matching real life, where the error always lands after
    // the bar is already open.
    function renderWithProviderError() {
      const result = renderBar();
      act(() => {
        useFilterStore.getState().setAiError(providerError);
      });
      return result;
    }

    it("swaps the tip row for a red alert carrying the registry's copy", () => {
      renderWithProviderError();
      const alert = screen.getByRole("alert");
      expect(alert).toHaveTextContent(registryTitle(providerError.cause));
      // The model id is a detail row behind the chevron, not the headline.
      expect(alert).not.toHaveTextContent("azure/gpt-5.4-mini");
      expect(screen.queryByText(/save the result as a lens/i)).not.toBeInTheDocument();
    });

    it("links to Model Providers settings", () => {
      renderWithProviderError();
      const link = screen.getByRole("link", {
        name: /review model providers/i,
      });
      expect(link).toHaveAttribute("href", "/settings/model-providers");
    });

    it("expands structured details on demand", async () => {
      const user = userEvent.setup();
      renderWithProviderError();
      await user.click(screen.getByRole("button", { name: /show error details/i }));
      expect(screen.getByText("Status")).toBeInTheDocument();
      expect(screen.getByText("404")).toBeInTheDocument();
      expect(screen.getByText("Provider")).toBeInTheDocument();
    });

    it("dismisses on the close button like the docked banner", async () => {
      const user = userEvent.setup();
      renderWithProviderError();
      await user.click(screen.getByRole("button", { name: /dismiss error/i }));
      expect(screen.queryByRole("alert")).not.toBeInTheDocument();
      expect(useFilterStore.getState().aiError).toBeNull();
    });

    it("keeps the strip outside the pill click-transparent", () => {
      renderWithProviderError();
      // The fixed strip spans the search bar's full width; only the error
      // pill itself may take pointer events, or everything underneath the
      // band becomes unclickable while an error shows.
      const alert = screen.getByRole("alert");
      expect(alert).toHaveStyle({ pointerEvents: "auto" });
      const strip = alert.closest('[style*="position: fixed"]');
      expect(strip).not.toBeNull();
      expect((strip as HTMLElement).style.pointerEvents).toBe("none");
    });
  });

  describe("given a failure that has nothing to do with model configuration", () => {
    it("renders the registry copy without the settings link", () => {
      const cause = new Error("socket hang up");
      renderBar();
      act(() => {
        useFilterStore.getState().setAiError({ code: "unknown", cause });
      });
      const alert = screen.getByRole("alert");
      expect(alert).toHaveTextContent(registryTitle(cause));
      // Sending the operator to Model Providers for a network blip is advice
      // that can only waste their time.
      expect(
        screen.queryByRole("link", { name: /review model providers/i }),
      ).not.toBeInTheDocument();
    });
  });
});
