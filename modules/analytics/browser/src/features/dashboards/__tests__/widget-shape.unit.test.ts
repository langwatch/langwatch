/**
 * What Langy suggests beside the editor: changes that fit what the widget draws.
 * @see modules/dashboard/specs/dashboards-widget-flow.feature
 */

import { describe, expect, it } from "vitest";

import { CATALOGUE_WIDGETS } from "../catalogue/index.ts";
import { widgetAsks } from "../langy/model/board-langy.ts";
import { widgetShape } from "../model/widget-shape.ts";

const query = (sql: string) => ({ queries: [{ name: "main", sql }] });

describe("widgetShape", () => {
  /** @scenario "Widget editor: Langy's suggestions fit the widget's shape" */
  it("reads a line from a query bucketed by the board's grain", () => {
    expect(
      widgetShape(
        query(
          "SELECT toStartOfInterval(OccurredAt, INTERVAL {dashboard_context_granularity_seconds:UInt32} SECOND) AS bucket, count() FROM traces GROUP BY bucket",
        ),
      ),
    ).toBe("line");
  });

  /** @scenario "Widget editor: Langy's suggestions fit the widget's shape" */
  it("reads bars from a grouped query, and one figure from anything else", () => {
    expect(widgetShape(query("SELECT Model, count() FROM traces GROUP BY Model"))).toBe("bars");
    expect(widgetShape(query("SELECT count() FROM traces"))).toBe("tile");
  });

  /** @scenario "Widget editor: Langy's suggestions fit the widget's shape" */
  it("takes a catalogue widget's shape from its question, whatever its queries", () => {
    const changed = CATALOGUE_WIDGETS.find(({ questionType }) => questionType === "changed")!;

    expect(
      widgetShape({
        ...query("SELECT count() FROM traces"),
        source: { kind: "catalogue", catalogueId: changed.id },
      }),
    ).toBe("line");
  });
});

describe("widgetAsks", () => {
  /** @scenario "Widget editor: Langy's suggestions fit the widget's shape" */
  it("suggests starting points for a new widget and changes that fit each shape", () => {
    expect(widgetAsks("new").map(({ ask }) => ask)).toContain("Show daily cost by model");
    expect(widgetAsks("line").map(({ ask }) => ask)).toContain("Change this to a weekly view");
    expect(widgetAsks("bars").map(({ ask }) => ask)).toContain("Show the top 10");
    expect(widgetAsks("tile").map(({ ask }) => ask)).toContain("Compare with last period");
  });
});
