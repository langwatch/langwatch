/**
 * @vitest-environment jsdom
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";

import { ChartErrorState } from "../ChartErrorState";

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

      expect(screen.getByText("Something went wrong")).toBeInTheDocument();
      expect(
        screen.getByRole("button", { name: /retry/i }),
      ).toBeInTheDocument();
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
    it("shows the registry's copy, never the code slug", () => {
      renderChartErrorState({ error: handledError("query_timeout") });

      expect(screen.getByText("This search took too long")).toBeInTheDocument();
      expect(
        screen.getByText("Narrow the time range or add a filter, then try again."),
      ).toBeInTheDocument();
      expect(screen.queryByText("query_timeout")).not.toBeInTheDocument();
    });
  });
});
