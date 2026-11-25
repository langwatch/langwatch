/**
 * "Which models does my agent use?": each model's share is of the requests that call a model.
 * The share is the stored snippet the frame runs; evaluating it over fake query rows is the test.
 * @see modules/dashboard/specs/dashboards-v2.feature AC242b
 */
import { describe, expect, it } from "vitest";

import { MODEL_SHARES } from "../../templates/model/question-table-widgets.ts";
import { NUMBERS } from "../../templates/model/widget-code-parts.ts";
import { CATALOGUE_WIDGET_BUILDS } from "../widgets/index.ts";

type Rows = { data: Record<string, unknown>[] };

// oxlint-disable-next-line no-implied-eval
const modelShares = new Function(`${NUMBERS}\n${MODEL_SHARES}\nreturn modelShares;`)() as (
  models: Rows,
  modelRequests: Rows,
) => { model: string; share: number | null }[];

describe("given the models card", () => {
  /** @scenario "AC242b Model usage: each model's share is of the requests that call a model" */
  it("divides each model's requests by the requests that call a model", () => {
    const models = {
      data: [
        { model: "gpt-5", traces: "14" },
        { model: "claude-sonnet", traces: "10" },
        { model: "gemini", traces: "20" },
      ],
    };
    const shares = modelShares(models, { data: [{ traces: "38" }] });

    expect(shares.map(({ model, share }) => [model, share?.toFixed(3)])).toEqual([
      ["gpt-5", "0.368"],
      ["claude-sonnet", "0.263"],
      ["gemini", "0.526"],
    ]);
    expect(modelShares(models, { data: [] }).every(({ share }) => share === null)).toBe(true);
  });

  /** @scenario "AC242b Model usage: each model's share is of the requests that call a model" */
  it("counts only the requests that call at least one model as the whole", () => {
    const build = CATALOGUE_WIDGET_BUILDS["top-models"];
    expect(build?.queries.modelRequests).toContain("notEmpty(Models)");
    expect(build?.code.tsx).toContain("modelShares(models, modelRequests)");
  });
});
