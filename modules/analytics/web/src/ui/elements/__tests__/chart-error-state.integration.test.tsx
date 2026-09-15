/**
 * @vitest-environment jsdom
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";

import { ChartErrorState } from "../chart-error-state.tsx";

afterEach(cleanup);

/** A tRPC error envelope carrying a handled payload, as the boundary sends it. */
function handledError(code: string) {
  return {
    message: code,
    data: { error: { code, httpStatus: 500, fault: "platform", tips: [] } },
  };
}

function renderChartErrorState({
  error = new Error("boom"),
  onRetry = vi.fn(),
}: {
  error?: unknown;
  onRetry?: () => void;
} = {}) {
  return {
    onRetry,
    ...render(
      <ChakraProvider value={defaultSystem}>
        <ChartErrorState error={error} onRetry={onRetry} />
      </ChakraProvider>,
    ),
  };
}

describe("<ChartErrorState />", () => {
  describe("when the query has failed", () => {
    /** @scenario "Chart shows error state when analytics query fails" */
    /** @scenario "Error state is visually distinct from empty data state" */
    it("displays an error heading and retry button (distinct from 'No data')", () => {
      renderChartErrorState();

      // An unhandled failure has no copy of its own, so the caller's
      // fallback names what the user was looking at.
      expect(screen.getByText("Failed to load chart data")).toBeInTheDocument();
      expect(screen.getByRole("button", { name: /retry/i })).toBeInTheDocument();
      expect(screen.queryByText(/no data/i)).not.toBeInTheDocument();
    });
  });

  describe("when the user clicks retry", () => {
    it("calls the onRetry callback", async () => {
      const user = userEvent.setup();
      const { onRetry } = renderChartErrorState();

      const retryButton = screen.getByRole("button", { name: /retry/i });
      await user.click(retryButton);

      expect(onRetry).toHaveBeenCalledTimes(1);
    });
  });

  describe("when the failure is a handled error", () => {
    /**
     * THE CODE SLUG IS THE ONE THING A PACKAGE CAN STILL PIN HERE — the
     * presentation registry is `platform/app`'s and does not travel, so this
     * asserts only the failed action, never the code slug (#5984: the wire
     * message IS the code).
     */
    it("names the action that failed and never the code slug", () => {
      renderChartErrorState({ error: handledError("query_timeout") });

      expect(screen.getByText("Failed to load chart data")).toBeInTheDocument();
      expect(screen.queryByText("query_timeout")).not.toBeInTheDocument();
    });
  });
});
