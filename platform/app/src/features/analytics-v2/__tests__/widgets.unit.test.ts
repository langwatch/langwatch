/**
 * The nine Analytics v2 widget definitions — pure data, no rendering.
 *
 * Each definition must be a valid `DashboardWidgetDefinition` (the same
 * shape a persisted `CustomGraph.graph` column stores) so the page can hand
 * it straight to `DashboardWidgetFrame` unmodified. These tests check the
 * *contract* every widget must satisfy, not any one widget's chart choice:
 * schema validity, the reserved period placeholders, no read path back to
 * the legacy analytics pipeline, and (for Top Topics specifically) the
 * topic-id grouping and raw-id fallback the spec calls out by name.
 *
 * Compilation with the real widget author runtime
 * (`~/features/custom-chart-playground/bridge/authorRuntime`) needs Babel
 * loaded from a CDN into a live DOM — not something this unit test can do
 * deterministically. Per the test brief, compilation is skipped and each
 * widget's `code` is asserted to call `LW.useChartQuery("main"` instead,
 * which is the one call every widget must make to read data at all.
 *
 * @see specs/analytics/analytics-v2.feature
 */

import { describe, expect, it } from "vitest";

import { dashboardWidgetDefinitionSchema } from "~/server/analytics/dashboardWidgetDefinition";

import {
  ANALYTICS_V2_EMPTY_STATE_TEXT,
  ANALYTICS_V2_WIDGET_IDS,
  ANALYTICS_V2_WIDGETS,
} from "../widgets";

const EXPECTED_IDS_IN_ORDER = [
  "trace-count-over-time",
  "total-cost-over-time",
  "tokens-over-time",
  "latency-percentiles",
  "satisfaction-over-time",
  "evaluation-pass-rate",
  "average-traces-per-thread",
  "top-models",
  "top-topics",
] as const;

const EXPECTED_TITLES_IN_ORDER = [
  "Trace count over time",
  "Total cost over time",
  "Tokens over time",
  "Latency percentiles",
  "Satisfaction over time",
  "Evaluation pass rate",
  "Average traces per thread",
  "Top models",
  "Top topics",
] as const;

const FORBIDDEN_LEGACY_TOKENS = [
  "analytics.",
  "elasticsearch",
  "getTimeseries",
];

describe("ANALYTICS_V2_WIDGET_IDS", () => {
  /** @scenario "Every chart reads its data through the LangWatchQL query API only" */
  it("lists the nine widget ids in contract order", () => {
    expect(ANALYTICS_V2_WIDGET_IDS).toEqual(EXPECTED_IDS_IN_ORDER);
  });
});

describe("ANALYTICS_V2_WIDGETS", () => {
  /** @scenario "Every chart reads its data through the LangWatchQL query API only" */
  it("has nine entries, ids and titles in contract order", () => {
    expect(ANALYTICS_V2_WIDGETS.map((w) => w.id)).toEqual(
      EXPECTED_IDS_IN_ORDER,
    );
    expect(ANALYTICS_V2_WIDGETS.map((w) => w.title)).toEqual(
      EXPECTED_TITLES_IN_ORDER,
    );
  });

  describe("given each widget's definition", () => {
    /** @scenario "Every chart reads its data through the LangWatchQL query API only" */
    it("parses as a valid dashboard widget definition", () => {
      for (const widget of ANALYTICS_V2_WIDGETS) {
        const result = dashboardWidgetDefinitionSchema.safeParse(
          widget.definition,
        );
        expect(result.success, `${widget.id} failed schema validation`).toBe(
          true,
        );
      }
    });

    /** @scenario "Every chart reads its data through the LangWatchQL query API only" */
    it("binds every query to the page period through the reserved placeholders", () => {
      for (const widget of ANALYTICS_V2_WIDGETS) {
        for (const query of widget.definition.queries) {
          expect(
            query.sql,
            `${widget.id}/${query.name} missing period_start placeholder`,
          ).toContain("{dashboard_context_period_start:DateTime}");
          expect(
            query.sql,
            `${widget.id}/${query.name} missing period_end placeholder`,
          ).toContain("{dashboard_context_period_end:DateTime}");
        }
      }
    });

    /** @scenario "Every chart reads its data through the LangWatchQL query API only" */
    it("reads data by calling LW.useChartQuery('main', ...) rather than compiling", () => {
      for (const widget of ANALYTICS_V2_WIDGETS) {
        expect(
          widget.definition.code,
          `${widget.id} never calls LW.useChartQuery("main"`,
        ).toContain('LW.useChartQuery("main"');
      }
    });

    describe("when the definitions are scanned for a read path back to legacy analytics", () => {
      /** @scenario "Every chart reads its data through the LangWatchQL query API only" */
      it("finds no reference to the legacy analytics router, elasticsearch, or getTimeseries", () => {
        for (const widget of ANALYTICS_V2_WIDGETS) {
          const haystack = [
            widget.definition.code,
            ...widget.definition.queries.map((q) => q.sql),
          ].join("\n");
          for (const token of FORBIDDEN_LEGACY_TOKENS) {
            expect(
              haystack,
              `${widget.id} references forbidden legacy token "${token}"`,
            ).not.toContain(token);
          }
        }
      });
    });
  });
});

describe("Top Topics widget", () => {
  const topTopics = ANALYTICS_V2_WIDGETS.find((w) => w.id === "top-topics");
  if (!topTopics)
    throw new Error("top-topics widget not found in ANALYTICS_V2_WIDGETS");
  const mainQuery = topTopics.definition.queries.find((q) => q.name === "main");
  if (!mainQuery) throw new Error("top-topics widget has no 'main' query");

  describe("given the query's GROUP BY clause", () => {
    /** @scenario "Top Topics groups by topic only and shows a raw id when the name is missing" */
    it("groups by the topic id alone, not by subtopic", () => {
      expect(mainQuery.sql).toContain("GROUP BY TopicId");
      expect(mainQuery.sql).not.toContain("SubTopicId");
    });
  });

  describe("when a topic's name cannot be resolved", () => {
    /** @scenario "Top Topics groups by topic only and shows a raw id when the name is missing" */
    it("left-joins the topics catalog and falls back to the raw topic id when the name is missing", () => {
      expect(mainQuery.sql).toMatch(
        /LEFT JOIN topics AS t ON t\.TopicId = x\.TopicId/,
      );
      expect(mainQuery.sql).toMatch(
        /if\(t\.TopicName IS NULL OR t\.TopicName = '', x\.TopicId, t\.TopicName\)/,
      );
    });
  });

  describe("given all nine widget definitions", () => {
    /** @scenario "Top Topics groups by topic only and shows a raw id when the name is missing" */
    it("never shows the raw word 'unknown' for a missing name", () => {
      for (const widget of ANALYTICS_V2_WIDGETS) {
        const haystack = [
          widget.definition.code,
          ...widget.definition.queries.map((q) => q.sql),
        ].join("\n");
        expect(
          haystack.toLowerCase(),
          `${widget.id} contains the word "unknown"`,
        ).not.toContain("unknown");
      }
    });

    /** @scenario "Headline numbers match the legacy analytics for the same period" */
    it("filters no widget SQL on TotalDurationMs > 0 (legacy applies no duration filter, AC5 parity)", () => {
      for (const widget of ANALYTICS_V2_WIDGETS) {
        for (const query of widget.definition.queries) {
          expect(
            query.sql,
            `${widget.id}/${query.name} filters on TotalDurationMs > 0`,
          ).not.toContain("TotalDurationMs > 0");
        }
      }
    });

    /** @scenario "Every chart reads its data through the LangWatchQL query API only" */
    it("reads only from the LangWatchQL catalog views", () => {
      const ALLOWED_VIEWS = new Set([
        "trace_metrics",
        "trace_metrics_by_minute",
        "traces",
        "evaluation_metrics",
        "topics",
      ]);
      const fromOrJoin = /\b(?:FROM|JOIN)\s+([A-Za-z_][A-Za-z0-9_]*)/g;
      for (const widget of ANALYTICS_V2_WIDGETS) {
        for (const query of widget.definition.queries) {
          const targets = [...query.sql.matchAll(fromOrJoin)].map((m) => m[1]);
          expect(
            targets.length,
            `${widget.id}/${query.name} reads from no view`,
          ).toBeGreaterThan(0);
          for (const target of targets) {
            expect(
              ALLOWED_VIEWS.has(target as string),
              `${widget.id}/${query.name} reads from disallowed view "${target}"`,
            ).toBe(true);
          }
        }
      }
    });
  });
});

describe("ANALYTICS_V2_EMPTY_STATE_TEXT", () => {
  /** @scenario "A period with no traces shows an empty state, not an error" */
  it('is exactly "No data in this period."', () => {
    expect(ANALYTICS_V2_EMPTY_STATE_TEXT).toBe("No data in this period.");
  });

  describe("given each widget's code", () => {
    /** @scenario "A period with no traces shows an empty state, not an error" */
    it("shows the empty state text when the query returns zero rows", () => {
      for (const widget of ANALYTICS_V2_WIDGETS) {
        expect(
          widget.definition.code,
          `${widget.id} never renders ANALYTICS_V2_EMPTY_STATE_TEXT`,
        ).toContain(ANALYTICS_V2_EMPTY_STATE_TEXT);
      }
    });

    /** @scenario "A period with no traces shows an empty state, not an error" */
    it("branches on data.length === 0 to reach the empty state, not a thrown error", () => {
      for (const widget of ANALYTICS_V2_WIDGETS) {
        expect(
          widget.definition.code,
          `${widget.id} does not branch on data.length === 0`,
        ).toContain("data.length === 0");
      }
    });
  });
});
