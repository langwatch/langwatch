/**
 * The model picker scrolled in real Chromium: layout and hit testing, which jsdom reports as zero.
 * @see packages/design-system/specs/model-picker-search.feature
 */
import { cleanup, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { userEvent } from "vitest/browser";

import { ProviderModelSelector } from "../../src/components/scope/provider-model-selector.tsx";
import { probeSearchBand, renderWithDesignSystem } from "../../src/testing/index.tsx";

afterEach(cleanup);

const OPTIONS = Array.from({ length: 40 }, (_, index) => ({
  label: `gpt-model-${index}`,
  value: `openai/gpt-model-${index}`,
}));

describe("the Default models picker scrolled in a real engine", () => {
  /** @scenario "A scrolled Default models picker keeps its rows below the search" */
  it("draws no row over or above the search field", async () => {
    renderWithDesignSystem(
      <ProviderModelSelector
        model=""
        query={{ data: OPTIONS, isLoading: false }}
        onChange={() => {}}
        inheritOption={{ label: "Inherit (Default in this config)", model: "openai/gpt-model-1" }}
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
