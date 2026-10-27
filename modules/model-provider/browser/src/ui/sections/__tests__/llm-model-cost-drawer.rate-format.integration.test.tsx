// @vitest-environment jsdom
/** Rates edit as plain decimals: a tiny stored rate never shows exponent notation. */

import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const { mockMutate } = vi.hoisted(() => ({ mockMutate: vi.fn() }));

vi.mock("@langwatch/browser-host/drawer", () => ({
  useDrawer: () => ({ closeDrawer: vi.fn() }),
}));

vi.mock("../../../behavior/model-provider-api.ts", () => ({
  modelProviderApi: {
    useUtils: () => ({ modelProvider: { invalidate: vi.fn() } }),
    llmModelCost: {
      getAllForProject: {
        useQuery: () => ({
          data: [
            {
              id: "cost-1",
              organizationId: "organization-1",
              projectId: null,
              scopeType: "PROJECT",
              scopeId: "proj-1",
              model: "anthropic/claude",
              regex: "^claude$",
              inputCostPerToken: 0.000001,
              outputCostPerToken: 0.000002,
              cacheReadCostPerToken: 1.155e-7,
              cacheCreationCostPerToken: 2.625e-7,
              cacheCreation1hCostPerToken: 4.2e-7,
              createdAt: "2026-05-15T12:00:00.000Z",
              updatedAt: "2026-05-15T12:00:00.000Z",
            },
          ],
          isLoading: false,
          refetch: vi.fn(),
        }),
      },
      createOrUpdate: { useMutation: () => ({ mutate: mockMutate, isPending: false }) },
      previewMatchingSpans: {
        useQuery: () => ({
          data: {
            windowDays: 7,
            totalMatchedSpans: 0,
            matchedModels: [],
            sampleSpans: [],
            unmatchedModels: [],
          },
          isLoading: false,
        }),
      },
    },
  },
}));

import { FakeModelProviderHost, renderWithModelProviderHost } from "../../../testing.tsx";
import { LLMModelCostDrawer } from "../llm-model-cost-drawer.tsx";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("given the cost drawer editing a rule with tiny cache rates", () => {
  it("shows every rate as a plain decimal", () => {
    renderWithModelProviderHost(<LLMModelCostDrawer id="cost-1" />, new FakeModelProviderHost());

    expect(screen.getByDisplayValue("0.0000001155")).toBeInTheDocument();
    expect(screen.getByDisplayValue("0.0000002625")).toBeInTheDocument();
    expect(screen.getByDisplayValue("0.00000042")).toBeInTheDocument();
    expect(screen.queryByDisplayValue(/e-/)).not.toBeInTheDocument();
  });

  it("saves a typed plain decimal and a pasted exponent as numbers", async () => {
    renderWithModelProviderHost(<LLMModelCostDrawer id="cost-1" />, new FakeModelProviderHost());

    fireEvent.change(screen.getByDisplayValue("0.0000001155"), {
      target: { value: "0.00000012" },
    });
    fireEvent.change(screen.getByDisplayValue("0.00000042"), { target: { value: "5e-7" } });
    fireEvent.click(screen.getByRole("button", { name: /save/i }));

    await waitFor(() => expect(mockMutate).toHaveBeenCalledTimes(1));
    expect(mockMutate.mock.calls[0]?.[0]).toMatchObject({
      id: "cost-1",
      inputCostPerToken: 0.000001,
      cacheReadCostPerToken: 1.2e-7,
      cacheCreationCostPerToken: 2.625e-7,
      cacheCreation1hCostPerToken: 5e-7,
    });
  });
});
