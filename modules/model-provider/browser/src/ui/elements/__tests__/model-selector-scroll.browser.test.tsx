/**
 * The evaluator's model picker scrolled in real Chromium: layout and hit testing, which jsdom
 * reports as zero.
 * @see packages/design-system/specs/model-picker-search.feature
 */
import { probeSearchBand, renderWithDesignSystem } from "@langwatch/design-system/testing";
import { cleanup, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { userEvent } from "vitest/browser";

vi.mock("@langwatch/browser-host/use-organization-team-project", () => ({
  useOrganizationTeamProject: () => ({ project: { id: "proj-1" } }),
}));

vi.mock("../../../behavior/model-provider-api.ts", () => ({
  api: {
    modelProvider: {
      listAllForProjectForFrontend: {
        useQuery: () => ({
          data: [{ provider: "openai", enabled: true, customModels: null }],
          isLoading: false,
        }),
      },
    },
  },
}));

const { ModelSelector } = await import("../model-selector.tsx");

afterEach(cleanup);

const OPTIONS = Array.from({ length: 40 }, (_, index) => `openai/gpt-model-${index}`);

describe("the evaluator model picker scrolled in a real engine", () => {
  /** @scenario "A scrolled evaluator model picker keeps its rows below the search" */
  it("draws no row over or above the search field", async () => {
    renderWithDesignSystem(
      <ModelSelector
        model="openai/gpt-model-0"
        options={OPTIONS}
        onChange={() => undefined}
        builtInModels={[{ value: "langwatch/instant-evals", label: "Instant Evals" }]}
      />,
    );
    await userEvent.click(screen.getByRole("combobox"));
    const search = await screen.findByPlaceholderText("Search models");

    for (const scrollBy of [12, 200]) {
      const probe = await probeSearchBand({ search, scrollBy });
      expect(probe.scrolled).toBeGreaterThan(0);
      expect(probe.rowsOverSearch).toEqual([]);
      expect(probe.searchOnTop).toBe(true);
    }
  });
});
