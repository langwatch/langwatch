/**
 * Real-Chromium Model Providers layout: the providers table spans the page column, which jsdom
 * cannot lay out. It used to shrink to its content while Default models below ran full width.
 * Spec: specs/model-providers/provider-list.feature
 */

import { cleanup, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { page } from "vitest/browser";

import { renderWithModelProviderHost } from "../../../testing.tsx";

vi.mock("../../../behavior/model-provider-api.ts", () => ({
  modelProviderApi: {
    useUtils: () => ({ modelProvider: { invalidate: vi.fn() } }),
    modelProvider: {
      delete: { useMutation: () => ({ mutateAsync: vi.fn(), isPending: false }) },
      testConnection: { useMutation: () => ({ mutateAsync: vi.fn(), isPending: false }) },
      getDefaultModelsForProject: { useQuery: () => ({ data: void 0, isLoading: true }) },
      getResolvedDefault: { useQuery: () => ({ data: void 0, isLoading: false }) },
      codexApplyCodingDefaults: { useMutation: () => ({ mutateAsync: vi.fn(), isPending: false }) },
      deleteDefaultModelsConfig: {
        useMutation: () => ({ mutateAsync: vi.fn(), isPending: false }),
      },
    },
  },
}));

vi.mock("../../../behavior/use-all-model-providers-list.ts", () => ({
  useAllModelProvidersList: () => ({
    providers: [
      {
        id: "mp-1",
        provider: "openai",
        name: "OpenAI",
        enabled: true,
        scopes: [{ scopeType: "ORGANIZATION", scopeId: "org-1" }],
      },
    ],
    isLoading: false,
    refetch: vi.fn(),
  }),
}));

const { default: ModelProvidersScreen } = await import("../model-providers-screen.tsx");

beforeEach(async () => {
  await page.viewport(1280, 800);
  renderWithModelProviderHost(<ModelProvidersScreen />);
});

afterEach(() => cleanup());

describe("given the Model Providers screen in a real browser", () => {
  describe("when providers are listed", () => {
    /** @scenario The providers table spans the page column */
    it("draws the providers table as wide as the page column", async () => {
      await screen.findByText("OpenAI");
      // The card is the table's named scroll region; Default models draws its own table below.
      const card = screen.getByRole("region", { name: "Model providers" });
      const column = card.parentElement!;

      expect(card.getBoundingClientRect().width).toBe(column.getBoundingClientRect().width);
    });
  });
});
