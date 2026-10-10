// @vitest-environment jsdom
/**
 * The cost drawer's live regex tester: match, no match and an invalid pattern, as the reader types.
 * Spec: specs/model-providers/model-cost-scoping.feature
 */

import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@langwatch/browser-host/drawer", () => ({
  useDrawer: () => ({ closeDrawer: vi.fn() }),
}));

vi.mock("../../../behavior/model-provider-api.ts", () => ({
  modelProviderApi: {
    useUtils: () => ({ modelProvider: { invalidate: vi.fn() } }),
    llmModelCost: {
      getAllForProject: {
        useQuery: () => ({ data: [], isLoading: false, refetch: vi.fn() }),
      },
      createOrUpdate: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
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

afterEach(cleanup);

function type(pattern: string, sample: string) {
  renderWithModelProviderHost(<LLMModelCostDrawer />, new FakeModelProviderHost());
  const regex = document.querySelector<HTMLInputElement>('input[name="regex"]')!;
  fireEvent.change(regex, { target: { value: pattern } });
  fireEvent.change(screen.getByLabelText("Sample model string"), { target: { value: sample } });
}

describe("given the cost drawer's regex tester", () => {
  /** @scenario The cost drawer tests a regex against a sample model string as you type */
  it("says match when the sample fits the rule", () => {
    type("^openai/gpt-5", "openai/gpt-5.5");

    expect(screen.getByRole("status")).toHaveTextContent("Match");
  });

  it("says no match when it does not", () => {
    type("^openai/gpt-5", "anthropic/claude");

    expect(screen.getByRole("status")).toHaveTextContent("No match");
  });

  it("shows an inline error when the regex is invalid", () => {
    type("(unclosed", "openai/gpt-5.5");

    expect(screen.getAllByText("Please enter a valid regular expression").length).toBeGreaterThan(
      0,
    );
    expect(screen.queryByRole("status")).toBeNull();
  });
});
