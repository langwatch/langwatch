/**
 * The "Can I trust my numbers?" widgets read what their prototype cards show: checked on
 * the stored code and the LangWatchQL each one runs.
 */

import { describe, expect, it } from "vitest";

import { CATALOGUE_WIDGETS } from "../model/catalogue-widgets.ts";
import { implementedWidget } from "../model/widget-implementations.ts";
import { CATALOGUE_WIDGET_BUILDS } from "../widgets/index.ts";

function buildOf(id: string) {
  const build = CATALOGUE_WIDGET_BUILDS[id];
  if (!build) throw new Error(`no build for ${id}`);
  return { code: build.code.tsx, sql: build.queries };
}

describe("given the Can I trust my numbers? widgets", () => {
  /** @scenario "AC166 Can I trust my numbers?: data health names each missing field and what it unlocks" */
  it("counts each field as a filter, so its gap is never the frame's setup view", () => {
    const { code, sql } = buildOf("data-health");
    for (const filter of [
      "AND notEmpty(Models)",
      "AND (TotalCost IS NOT NULL OR empty(Models))",
      "AND UserId IS NOT NULL",
      "AND ConversationId IS NOT NULL",
      "AND notEmpty(Labels)",
      "AND Attributes['metadata.outcome'] != ''",
    ]) {
      expect(sql.fields).toContain(filter);
    }
    expect(sql.fields).toContain("SELECT 'all' AS field");
    expect(sql.fields).not.toMatch(/SELECT [^']*\b(?:UserId|TotalCost|ConversationId)\b[^\n]*AS/);
    expect(code).toContain("Missing on ");
    expect(code).toContain("Sending it unlocks: ");
    expect(code).toContain('<AllGood title="Every field arrives"');
  });

  /** @scenario "AC166 Can I trust my numbers?: data health names each missing field and what it unlocks" */
  it("names the built widgets that read each field", () => {
    const { code } = buildOf("data-health");
    const fields = JSON.parse(
      code.slice(
        code.indexOf("[", code.indexOf("const FIELDS")),
        code.indexOf("];", code.indexOf("const FIELDS")) + 1,
      ),
    ) as {
      key: string;
      unlocks: string[];
    }[];
    const unlocks = new Map(fields.map(({ key, unlocks: names }) => [key, names]));

    expect(fields.map(({ key }) => key)).toEqual([
      "model",
      "cost",
      "user",
      "conversation",
      "labels",
      "outcome",
    ]);
    expect(unlocks.get("cost")).toContain("What is my agent spending?");
    expect(unlocks.get("cost")).not.toContain("Is my data complete?");
  });

  /** @scenario "AC167 Can I trust my numbers?: cost accuracy counts traces with a model but no price" */
  it("counts traces with a model and those with an unpriced span, and lists the models", () => {
    const { code, sql } = buildOf("cost-accuracy");
    expect(sql.trend).toContain("uniqExactIf(TraceId, notEmpty(Models)) AS with_model");
    expect(sql.trend).toContain("uniqExactIf(TraceId, UnpricedSpanCount > 0) AS unpriced");
    expect(sql.models).toContain("ARRAY JOIN UnpricedModels AS model");
    expect(code).toContain("Models with no price");
    expect(code).toContain('<AllGood title="All costs priced"');
    expect(implementedWidget("cost-accuracy")?.definition.description).toContain(
      "before 7 October 2026",
    );
  });

  /** @scenario "AC168 Can I trust my numbers?: noise is traffic that clearly comes from tests, staging and the like" */
  it("reads origins and non-production environments, never health checks or duplicates", () => {
    const { code, sql } = buildOf("noise");
    expect(sql.sources).toContain("has(['playground', 'evaluation', 'simulation'], t.origin)");
    expect(sql.sources).toContain("ResourceAttributes['deployment.environment']");
    expect(sql.sources).toContain("Attributes['metadata.environment']");
    expect(sql.sources).toContain("JSONExtract(Attributes['langwatch.labels'], 'Array(String)')");
    expect(sql.sources).toContain("'staging'");
    expect(sql.sources).not.toMatch(/health|duplicate/i);
    expect(code).toContain('header: "Of cost"');
    expect(code).toContain('<AllGood title="No test traffic"');
    expect(CATALOGUE_WIDGETS.find(({ id }) => id === "noise")?.why).not.toMatch(
      /health|duplicate/i,
    );
  });
});
