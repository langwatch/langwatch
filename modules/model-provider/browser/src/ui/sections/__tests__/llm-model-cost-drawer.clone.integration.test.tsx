// @vitest-environment jsdom
/**
 * Cloning a catalogue rate: the drawer finds the row by model among the listed costs, which
 * carry main's catalogue rows (no id, `projectId: ""`), and starts a new rule from its rates.
 */

import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const { mockCreateOrUpdateMutate, mockCosts } = vi.hoisted(() => ({
  mockCreateOrUpdateMutate: vi.fn(),
  mockCosts: {
    current: [
      {
        id: "cost-1",
        organizationId: "organization-1",
        projectId: null,
        scopeType: "PROJECT",
        scopeId: "proj-1",
        model: "openai/gpt-5.5",
        regex: "^custom-override$",
        inputCostPerToken: 0.9,
        outputCostPerToken: 0.9,
        cacheReadCostPerToken: null,
        cacheCreationCostPerToken: null,
        cacheCreation1hCostPerToken: null,
        createdAt: "2026-05-15T12:00:00.000Z",
        updatedAt: "2026-05-15T12:00:00.000Z",
      },
      {
        projectId: "",
        model: "openai/gpt-5.5",
        regex: "^(openai\\/)?gpt-5[.-]5",
        inputCostPerToken: 0.000001,
        outputCostPerToken: 0.000002,
      },
    ] as Record<string, unknown>[],
  },
}));

vi.mock("@langwatch/browser-host/drawer", () => ({
  useDrawer: () => ({ closeDrawer: vi.fn() }),
}));

vi.mock("../../../behavior/model-provider-api.ts", () => ({
  modelProviderApi: {
    useUtils: () => ({ modelProvider: { invalidate: vi.fn() } }),
    llmModelCost: {
      getAllForProject: {
        useQuery: () => ({ data: mockCosts.current, isLoading: false, refetch: vi.fn() }),
      },
      createOrUpdate: {
        useMutation: () => ({ mutate: mockCreateOrUpdateMutate, isPending: false }),
      },
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

describe("given the cost drawer opened to clone a catalogue model", () => {
  describe("when the listed costs hold a stored rule and the catalogue rate for that model", () => {
    it("starts from the catalogue rate, not the stored rule", () => {
      renderWithModelProviderHost(
        <LLMModelCostDrawer cloneModel="openai/gpt-5.5" />,
        new FakeModelProviderHost(),
      );

      expect(screen.getByDisplayValue("openai/gpt-5.5")).toBeInTheDocument();
      expect(screen.getByDisplayValue("^(openai\\/)?gpt-5[.-]5")).toBeInTheDocument();
      expect(screen.queryByDisplayValue("^custom-override$")).not.toBeInTheDocument();
    });

    it("saves a new rule rather than editing an existing one", async () => {
      renderWithModelProviderHost(
        <LLMModelCostDrawer cloneModel="openai/gpt-5.5" />,
        new FakeModelProviderHost(),
      );

      fireEvent.click(screen.getByRole("button", { name: /save/i }));

      await waitFor(() => expect(mockCreateOrUpdateMutate).toHaveBeenCalledTimes(1));
      expect(mockCreateOrUpdateMutate.mock.calls[0]?.[0]).toMatchObject({
        id: undefined,
        model: "openai/gpt-5.5",
        regex: "^(openai\\/)?gpt-5[.-]5",
        inputCostPerToken: 0.000001,
        outputCostPerToken: 0.000002,
      });
    });
  });
});
