/**
 * @vitest-environment node
 * Binds specs/model-provider.feature.
 */
import { describe, expect, it } from "vitest";

import type { LLMModelCostRow } from "../llm-model-cost-row.ts";
import { filterAndSortCosts, nextSort } from "../model-cost-table.ts";

const rows: LLMModelCostRow[] = [
  {
    model: "openai/gpt-4o",
    regex: "^gpt-4o$",
    inputCostPerToken: 2,
    outputCostPerToken: 8,
    id: "c1",
  },
  { model: "anthropic/claude", regex: "^claude", inputCostPerToken: 1, outputCostPerToken: 9 },
  { model: "gemini", regex: "^gem", outputCostPerToken: 1 },
];
const base = { rows, search: "", provider: "", customOnly: false, sort: null };

describe("filterAndSortCosts", () => {
  /** @scenario "The model costs table filters by text, provider and custom rules" */
  it("filters by model text, regex text, provider and custom rows", () => {
    expect(filterAndSortCosts({ ...base, search: "CLAUDE" })).toHaveLength(1);
    expect(filterAndSortCosts({ ...base, search: "^gem" })[0]?.model).toBe("gemini");
    expect(filterAndSortCosts({ ...base, provider: "openai" })).toHaveLength(1);
    expect(filterAndSortCosts({ ...base, customOnly: true })[0]?.id).toBe("c1");
  });

  /** @scenario "The model costs table sorts by model, input cost and output cost" */
  it("sorts by model and by rate, keeping unset rates last in both directions", () => {
    const models = (sort: Parameters<typeof filterAndSortCosts>[0]["sort"]) =>
      filterAndSortCosts({ ...base, sort }).map((row) => row.model);
    expect(models({ key: "model", direction: "asc" })).toEqual([
      "anthropic/claude",
      "gemini",
      "openai/gpt-4o",
    ]);
    expect(models({ key: "inputCostPerToken", direction: "asc" })).toEqual([
      "anthropic/claude",
      "openai/gpt-4o",
      "gemini",
    ]);
    expect(models({ key: "inputCostPerToken", direction: "desc" })).toEqual([
      "openai/gpt-4o",
      "anthropic/claude",
      "gemini",
    ]);
  });
});

describe("nextSort", () => {
  /** @scenario "The model costs table sorts by model, input cost and output cost" */
  it("cycles ascending, descending, then off", () => {
    const asc = nextSort({ current: null, key: "model" });
    expect(asc).toEqual({ key: "model", direction: "asc" });
    const desc = nextSort({ current: asc, key: "model" });
    expect(desc).toEqual({ key: "model", direction: "desc" });
    expect(nextSort({ current: desc, key: "model" })).toBeNull();
  });
});
