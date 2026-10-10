/**
 * Real-Chromium Model Costs filters: narrowing by typing, picking and toggling, the empty state,
 * and the wide table scrolling inside its card, which jsdom cannot lay out.
 * Spec: specs/model-providers/model-cost-filtering.feature
 */

import { cleanup, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";

import { renderWithModelProviderHost } from "../../../testing.tsx";

const { mockState } = vi.hoisted(() => ({
  mockState: { costs: [] as Record<string, unknown>[] },
}));

vi.mock("../../../behavior/model-provider-api.ts", () => ({
  modelProviderApi: {
    llmModelCost: {
      getAllForProject: {
        useQuery: () => ({ data: mockState.costs, isLoading: false, refetch: vi.fn() }),
      },
      delete: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
    },
  },
}));

vi.mock("../../../behavior/use-all-model-providers-list.ts", () => ({
  useAllModelProvidersList: () => ({ providers: [], isLoading: false }),
}));

const { default: ModelCostsScreen } = await import("../model-costs-screen.tsx");

const CATALOGUE_ROW = {
  projectId: "",
  model: "openai/gpt-5.5",
  regex: "^openai/gpt-5\\.5$",
  inputCostPerToken: 0.000001,
  outputCostPerToken: 0.000002,
  cacheReadCostPerToken: 0.0000001,
  cacheCreationCostPerToken: 0.00000125,
  cacheCreation1hCostPerToken: 0.000002,
  inputImageCostPerToken: 0.000008,
  outputImageCostPerToken: 0.00003,
};

const STORED_ROW = {
  ...CATALOGUE_ROW,
  id: "cost_1",
  organizationId: "organization-1",
  projectId: "proj-1",
  scopeType: "PROJECT",
  scopeId: "proj-1",
  model: "anthropic/claude-sonnet-4-6",
  regex: "^anthropic/claude",
  createdAt: "2026-05-15T12:00:00.000Z",
  updatedAt: "2026-05-15T12:00:00.000Z",
};

const THIRD_ROW = {
  ...CATALOGUE_ROW,
  model: "anthropic/claude-haiku-4-5",
  regex: "^anthropic/claude-haiku",
};

const bodyRows = () => document.querySelectorAll("tbody tr");
const countLine = async (text: string) => {
  await waitFor(() => expect(screen.getByText(text)).toBeVisible());
};

beforeEach(async () => {
  mockState.costs = [STORED_ROW, CATALOGUE_ROW, THIRD_ROW];
  await page.viewport(1024, 700);
  renderWithModelProviderHost(<ModelCostsScreen />);
});

afterEach(() => cleanup());

describe("given the Model Costs screen in a real browser", () => {
  describe("when the reader types in the search box", () => {
    /** @scenario Searching narrows the table by model name or regex rule */
    it("narrows the rows and counts the match", async () => {
      await userEvent.fill(page.getByLabelText("Search model costs"), "CLAUDE");

      await countLine("Showing 2 of 3 models.");
      await expect.poll(() => bodyRows().length).toBe(2);
    });
  });

  describe("when the reader picks a provider", () => {
    /** @scenario The provider filter narrows the table to one provider */
    it("lists only that provider's models", async () => {
      await userEvent.selectOptions(page.getByLabelText("Filter by provider"), "openai");

      await expect.poll(() => bodyRows().length).toBe(1);
      await waitFor(() => expect(screen.getByText("openai/gpt-5.5")).toBeVisible());
    });
  });

  describe("when the reader turns on Custom only", () => {
    /** @scenario Custom only shows just the project's own cost rules */
    it("lists only stored rules", async () => {
      await userEvent.click(page.getByRole("button", { name: "Custom only" }));

      await expect.poll(() => bodyRows().length).toBe(1);
      await waitFor(() => expect(screen.getByText("anthropic/claude-sonnet-4-6")).toBeVisible());
    });
  });

  describe("when nothing matches", () => {
    /** @scenario A filter that matches nothing shows an empty state */
    it("shows the empty state, and Clear filters restores every row", async () => {
      await userEvent.fill(page.getByLabelText("Search model costs"), "no-such-model");

      await waitFor(() => expect(screen.getByText("No models match")).toBeVisible());
      await countLine("Showing 0 of 3 models.");

      await userEvent.click(page.getByRole("button", { name: "Clear filters" }).first());

      await countLine("What each of the 3 models costs per token.");
      await expect.poll(() => bodyRows().length).toBe(3);
    });
  });

  describe("when the table is wider than the page column", () => {
    /** @scenario The wide table scrolls inside its card instead of the page */
    it("scrolls horizontally in the card and leaves the page unscrolled", async () => {
      await expect.poll(() => bodyRows().length).toBe(3);
      const table = document.querySelector("table")!;
      const card = table.parentElement!;

      expect(getComputedStyle(card).overflowX).toBe("auto");
      expect(card.scrollWidth).toBeGreaterThan(card.clientWidth);
      expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(
        document.documentElement.clientWidth,
      );
    });
  });
});
