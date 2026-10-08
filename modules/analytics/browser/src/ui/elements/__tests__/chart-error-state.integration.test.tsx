/**
 * @vitest-environment jsdom
 */
import { renderWithDesignSystem } from "@langwatch/design-system/testing";
import { cleanup, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";

import { ChartErrorIndicator, ChartErrorState } from "../chart-error-state.tsx";

afterEach(cleanup);

const TRACE_ID = "0af7651916cd43dd8448eb211c80319c";

/** A tRPC error envelope carrying a handled payload, as the boundary sends it. */
function handledError(code: string) {
  return {
    message: code,
    data: {
      error: {
        code,
        httpStatus: 422,
        fault: "customer",
        traceId: TRACE_ID,
        tips: ["Add filters to reduce the amount of data scanned"],
      },
    },
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
    ...renderWithDesignSystem(<ChartErrorState error={error} onRetry={onRetry} />),
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
      expect(screen.getByText("Couldn't load this chart")).toBeInTheDocument();
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

  describe("when the failure is a handled error the registry knows", () => {
    /** @scenario "A failed chart panel shows a compact message and a Retry" */
    it("shows the registry headline and advice, never the code slug or the tips", () => {
      renderChartErrorState({ error: handledError("query_memory_exceeded") });

      const alert = screen.getByRole("alert");
      expect(within(alert).getByText("This search was too large")).toBeInTheDocument();
      expect(
        within(alert).getByText("Narrow the time range, add a filter, or select fewer fields."),
      ).toBeInTheDocument();
      expect(screen.queryByText("query_memory_exceeded")).not.toBeInTheDocument();
      expect(
        screen.queryByText("Add filters to reduce the amount of data scanned"),
      ).not.toBeInTheDocument();
    });

    /** @scenario "A failed chart panel shows a compact message and a Retry" */
    it("keeps the error id reachable", () => {
      renderChartErrorState({ error: handledError("query_memory_exceeded") });

      expect(
        within(screen.getByRole("alert")).getByTitle(`Error ID: ${TRACE_ID}`),
      ).toBeInTheDocument();
    });
  });
});

describe("<ChartErrorIndicator />", () => {
  describe("when the query has failed", () => {
    it("says it could not load, holds no button, and carries the copy for assistive technology", () => {
      renderWithDesignSystem(<ChartErrorIndicator error={handledError("query_memory_exceeded")} />);

      const indicator = screen.getByTestId("chart-error-indicator");
      expect(within(indicator).getByText("Couldn't load")).toBeInTheDocument();
      expect(indicator).toHaveTextContent("This search was too large");
      expect(indicator).not.toHaveTextContent("query_memory_exceeded");
      expect(screen.queryByRole("button")).not.toBeInTheDocument();
    });
  });
});
