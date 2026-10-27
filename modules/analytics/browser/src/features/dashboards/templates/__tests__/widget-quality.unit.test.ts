/**
 * Template and catalogue widgets read the query's completeness report instead of guessing:
 * a sum that misses prices reads "+", an average divides by what it has, every bucket of the
 * window is drawn, and the card face keeps to plain words.
 * @see modules/dashboard/specs/dashboards-widget-quality.feature
 */

import { describe, expect, it } from "vitest";

import { isLowerBound, mergeBuckets } from "../../../../model/dashboard-widget/chartsLib/index.ts";
import {
  CATALOGUE_WIDGET_BUILDS,
  CATALOGUE_WIDGETS,
  DATA_REQUIREMENTS,
  IMPLEMENTED_WIDGET_IDS,
  implementedWidget,
} from "../../catalogue/index.ts";
import { BOARD_TEMPLATES } from "../index.ts";
import {
  BUCKETS,
  COMPLETENESS,
  DATES,
  GAP_BRIDGE,
  NUMBERS,
  SERIES_CHART,
} from "../model/widget-code-parts.ts";

type Row = Record<string, unknown>;
interface Query {
  data: Row[];
  completeness: unknown;
}

// The stored snippets are what the frame runs; evaluating them is the test.
// oxlint-disable-next-line no-implied-eval
const buckets = new Function(
  "mergeBuckets",
  `${NUMBERS}\n${DATES}\n${BUCKETS}\nreturn { withBuckets, latest, earliest };`,
)(mergeBuckets) as {
  withBuckets: (query: Query, series: unknown[]) => Row[];
  latest: (points: Row[], key: string) => unknown;
  earliest: (points: Row[], key: string) => unknown;
};

// oxlint-disable-next-line no-implied-eval
const completeness = new Function(
  "isLowerBound",
  `${NUMBERS}\n${COMPLETENESS}\nreturn { plus, pricedShare, unpricedRows };`,
)(isLowerBound) as {
  plus: (query: Partial<Query>) => string;
  pricedShare: (query: Partial<Query>) => number;
  unpricedRows: (query: Partial<Query>, listed?: string[]) => Row[];
};

const built = [
  ...IMPLEMENTED_WIDGET_IDS.flatMap((id) => implementedWidget(id) ?? []),
  ...BOARD_TEMPLATES.flatMap((template) => template.widgets),
];
const code = (id: string) => implementedWidget(id)?.definition.code ?? "";

const partialCost = {
  state: "partial",
  unit: "traces",
  total: 10,
  fields: [{ field: "TotalCost", label: "total cost", present: 10 }],
  unpriced: { count: 4, models: ["my-finetune-v2"] },
};

describe("given a cost sum and its query's completeness report", () => {
  /** @scenario "Widget quality: a sum that misses prices reads as a lower bound" */
  it("marks the sum with a + only when the report finds traces with no price", () => {
    expect(completeness.plus({ completeness: partialCost })).toBe("+");
    expect(completeness.plus({ completeness: { ...partialCost, unpriced: undefined } })).toBe("");
    expect(completeness.plus({ completeness: null })).toBe("");
  });

  /** @scenario "Widget quality: a sum that misses prices reads as a lower bound" */
  it("puts the + on the cost totals of the cost widgets", () => {
    for (const id of ["ck-status", "spend", "cost-verdict", "cost-waste"]) {
      expect(code(id), id).toMatch(/usd\([^)]*\)\)? \+ plus\(/);
    }
  });
});

describe("given an average cost", () => {
  /** @scenario "Widget quality: an average cost divides by the traces with a price" */
  it("divides by the share of traces with a known price", () => {
    expect(completeness.pricedShare({ completeness: partialCost })).toBeCloseTo(0.6);
    expect(completeness.pricedShare({ completeness: null })).toBe(1);
    for (const id of ["fd-cost-efficiency", "ck-kpis", "cost-verdict", "voice-cost-per-call"]) {
      expect(code(id), id).toContain("pricedShare(");
    }
  });
});

describe("given a cost list with a model that has no price", () => {
  /** @scenario "Widget quality: a model with no price shows its own row with a dash" */
  it("adds the model as a no-price row with no value, once", () => {
    const rows = completeness.unpricedRows({ completeness: partialCost });
    expect(rows).toEqual([expect.objectContaining({ label: "my-finetune-v2", value: null })]);
    expect(rows[0]?.note).toBe("no price");
    expect(completeness.unpricedRows({ completeness: partialCost }, ["my-finetune-v2"])).toEqual(
      [],
    );
  });

  /** @scenario "Widget quality: a model with no price shows its own row with a dash" */
  it("shows that row in every widget that lists cost by model or by source", () => {
    expect(code("fd-cost-efficiency")).toContain("unpricedRows(summary");
    expect(code("cost-by-model")).toContain("unpricedRows(spend");
    expect(code("top-models")).toContain("no price");
    expect(code("cost-by-source")).toContain("<UnpricedRow traces={unpriced} />");
  });
});

describe("given a source that sent no traces in the period", () => {
  /** @scenario "Widget quality: a source with no runs reads No runs, never $0.00" */
  it("reads No runs on its row of the spend split", () => {
    const source = CATALOGUE_WIDGET_BUILDS["cost-by-source"];
    expect(code("cost-by-source")).toContain('traces === 0 ? "No runs"');
    expect(source?.queries.main).toContain("1 AS traces");
  });
});

describe("given a chart over the board's period", () => {
  const day = (date: string) => `${date} 00:00:00`;
  const report = {
    buckets: ["2026-10-01", "2026-10-02", "2026-10-03"].map((date) => ({
      start: `${date}T00:00:00Z`,
      n: date === "2026-10-02" ? 0 : 5,
    })),
  };
  const query = {
    data: [
      { bucket: day("2026-10-01"), traces: 5, rate: 0.2 },
      { bucket: day("2026-10-03"), traces: 5, rate: 0.4 },
    ],
    completeness: report,
  };

  /** @scenario "Widget quality: a chart draws every bucket, a count as 0 and a measure as a gap" */
  it("adds the empty bucket as 0 for a count and as a gap for a measure", () => {
    const rows = buckets.withBuckets(query, [{ key: "traces", kind: "count" }, "rate"]);
    expect(rows.map((row) => row.traces)).toEqual([5, 0, 5]);
    expect(rows.map((row) => row.rate)).toEqual([0.2, null, 0.4]);
  });

  /** @scenario "Widget quality: a chart draws every bucket, a count as 0 and a measure as a gap" */
  it("leaves the rows as they are when the report buckets on other edges", () => {
    const weekly = { ...query, data: [{ bucket: day("2026-10-05"), traces: 5 }] };
    expect(buckets.withBuckets(weekly, ["traces"])).toEqual(weekly.data);
  });

  /** @scenario "Widget quality: a chart draws every bucket, a count as 0 and a measure as a gap" */
  it("bridges a gap with a faint dashed line and says No data on its hover", () => {
    expect(GAP_BRIDGE).toContain('[known(value) ? format(value) : "No data", name]');
    expect(SERIES_CHART).toContain("{series.filter((item) => !item.bars).map(bridge)}");
    expect(SERIES_CHART).toContain("filterNull={false}");
    expect(GAP_BRIDGE).toContain("connectNulls");
  });

  /** @scenario "Widget quality: a headline never reads an empty bucket" */
  it("reads lately and at the start from the buckets that have a value", () => {
    const points = [{ rate: null }, { rate: 0.1 }, { rate: 0.3 }, { rate: null }];
    expect(buckets.latest(points, "rate")).toBe(0.3);
    expect(buckets.earliest(points, "rate")).toBe(0.1);
    expect(buckets.latest([{ rate: null }], "rate")).toBeNull();
  });
});

describe("given every built widget's stored code", () => {
  /** @scenario "Widget quality: a chart draws every bucket, a count as 0 and a measure as a gap" */
  it("imports the chart kit helpers it calls and defines every helper it calls", () => {
    const helpers = ["bridge", "tipValue", "withBuckets", "latest", "plus", "pricedShare"];
    for (const { key, definition } of built) {
      for (const name of helpers) {
        if (!new RegExp(`[^.\\w]${name}\\(`).test(definition.code)) continue;
        expect(definition.code, `${key} ${name}`).toMatch(
          new RegExp(`function ${name}\\(|const ${name} = `),
        );
      }
      for (const name of ["mergeBuckets", "isLowerBound"]) {
        const imported = new RegExp(
          `import \\{[^}]*\\b${name}\\b[^}]*\\} from "@langwatch/charts"`,
        );
        expect(imported.test(definition.code), `${key} ${name}`).toBe(
          definition.code.includes(`${name}(`),
        );
      }
    }
  });

  /** @scenario "Widget quality: rigour stays off the card face" */
  it("labels no figure, column or line with stats words", () => {
    const statsLabel = /(label=\{?|label: |header: )"[^"]*\b(p50|p90|p95|p99|kappa|pts)\b/;
    for (const { key, definition } of built) {
      expect(definition.code, key).not.toMatch(statsLabel);
      expect(definition.code, key).not.toContain("p95 latency");
      expect(definition.code, key).not.toContain(' pts"');
    }
  });

  /** @scenario "Widget quality: a pass rate with nothing judged is a gap, never 0%" */
  it("gives a segment with nothing judged no pass rate", () => {
    expect(code("att-table")).toContain("judged > 0 ? passed / judged : null");
    expect(code("tools-error-rate")).toContain("pct(ratio(failures, calls))");
  });
});

describe("given the cards whose face carried a generated sentence", () => {
  /** @scenario "Widget quality: no generated sentence on a card face" */
  it("shows the figures and keeps the explaining sentence for the hover", () => {
    expect(code("ship-verdict")).not.toMatch(/can ship|Hold the newest run/);
    expect(code("so-verdict")).not.toContain("Ready to sign");
    expect(code("cost-by-source")).not.toContain("is test traffic");
    expect(code("cost-by-source")).toContain('label="test traffic"');
    expect(code("ck-attention")).toContain('detail={"The biggest drop of all "');
    expect(code("ck-attention")).toContain('" (Cohen\'s kappa), under the 0.80 target."');
  });
});

describe("given a widget's hand-kept needs", () => {
  const reported = new Set(DATA_REQUIREMENTS.filter(({ field }) => field).map(({ key }) => key));

  /** @scenario "Widget quality: a widget lists only the needs no query can see" */
  it("lists no need that a trace field alone meets, as the completeness report names those", () => {
    expect(reported.size).toBeGreaterThan(0);
    for (const widget of CATALOGUE_WIDGETS) {
      for (const need of widget.requirements) {
        expect(
          need.every((key) => reported.has(key)),
          `${widget.id} ${need.join("|")}`,
        ).toBe(false);
      }
    }
  });

  /** @scenario "Widget quality: a widget over trace fields shows the frame's setup view, not its own" */
  it("has no setup face of its own when its query reads only trace fields", () => {
    const traceFieldWidgets = [
      "topics",
      "conversation-length",
      "satisfaction-shift",
      "ask-rising",
      "ans-topics",
    ];
    for (const id of traceFieldWidgets) {
      const widget = implementedWidget(id);
      expect(widget?.definition.code, id).not.toContain("function CallToAction()");
      expect(
        widget?.definition.queries.map(({ name }) => name),
        id,
      ).not.toContain("present");
    }
  });
});
