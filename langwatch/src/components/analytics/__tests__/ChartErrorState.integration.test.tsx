/**
 * @vitest-environment jsdom
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";

import { ChartErrorState } from "../ChartErrorState";

afterEach(cleanup);

function renderChartErrorState({
  errorMessage = "ClickHouse connection timeout",
  onRetry = vi.fn(),
}: {
  errorMessage?: string;
  onRetry?: () => void;
} = {}) {
  return {
    onRetry,
    ...render(
      <ChakraProvider value={defaultSystem}>
        <ChartErrorState errorMessage={errorMessage} onRetry={onRetry} />
      </ChakraProvider>,
    ),
  };
}

describe("<ChartErrorState />", () => {
  describe("when the query has failed", () => {
    it("displays an error heading and retry button (distinct from 'No data')", () => {
      renderChartErrorState();

      expect(
        screen.getByText("Failed to load chart data"),
      ).toBeInTheDocument();
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

  describe("when the user expands error details", () => {
    it("shows the backend error message", async () => {
      const user = userEvent.setup();
      renderChartErrorState({
        errorMessage: "ClickHouse connection timeout",
      });

      // Error message should not be visible initially
      expect(
        screen.queryByText("ClickHouse connection timeout"),
      ).not.toBeVisible();

      // Click the show details trigger
      const detailsTrigger = screen.getByText(/show details/i);
      await user.click(detailsTrigger);

      await waitFor(() => {
        expect(
          screen.getByText("ClickHouse connection timeout"),
        ).toBeVisible();
      });
    });
  });
});
