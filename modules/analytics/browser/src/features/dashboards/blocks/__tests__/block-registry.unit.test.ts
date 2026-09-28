/**
 * The block library's pure contract: the previous-period delta, the registry
 * shape, the ten Flight Deck panels in prototype order, and statements that
 * read only catalog views. @see modules/dashboard/specs/dashboards-v1.feature
 */

import { describe, expect, it } from "vitest";

import {
  blockDefinitionSchema,
  blockState,
  periodDelta,
  SOURCE_EXISTENCE_SQL,
} from "../model/block-definition.ts";
import { BLOCK_REGISTRY, FLIGHT_DECK_BLOCKS } from "../model/block-registry.ts";

/** The views these blocks read, as `lwql-view-catalog.rules.ts` names them. */
const CATALOG_VIEWS = new Set([
  "traces",
  "spans",
  "simulations",
  "trace_metrics",
  "trace_metrics_by_minute",
  "model_usage_by_minute",
  "evaluation_metrics",
  "coding_sessions",
  "gateway_request_spend",
  "annotations",
  "topics",
]);

/** Every name after FROM or JOIN that is not a parenthesised subquery. */
function viewsRead(sql: string): string[] {
  return [...sql.matchAll(/\b(?:FROM|JOIN)\s+([A-Za-z_][A-Za-z0-9_.]*)/g)].map(
    (match) => match[1]!,
  );
}

describe("periodDelta", () => {
  describe("when the previous period had a value", () => {
    /** @scenario "AC5 Status tiles compare with the previous period" */
    it("answers the relative change", () => {
      expect(periodDelta({ current: 150, previous: 100 })).toBe(0.5);
      expect(periodDelta({ current: 50, previous: 100 })).toBe(-0.5);
    });
  });

  describe("when the previous period had nothing", () => {
    /** @scenario "AC5 Status tiles compare with the previous period" */
    it("answers no change rather than infinity", () => {
      expect(periodDelta({ current: 42, previous: 0 })).toBe(0);
    });
  });
});

describe("the block registry", () => {
  /** @scenario "AC5 Status tiles compare with the previous period" */
  it("parses every block against the definition schema, with unique ids", () => {
    for (const block of BLOCK_REGISTRY) {
      expect(blockDefinitionSchema.safeParse(block).success, block.id).toBe(true);
    }
    expect(new Set(BLOCK_REGISTRY.map((block) => block.id)).size).toBe(BLOCK_REGISTRY.length);
  });

  /** @scenario "AC5 Status tiles compare with the previous period" */
  it("gives every block non-empty statements that read only catalog views", () => {
    const statements = [
      ...BLOCK_REGISTRY.flatMap((block) => block.queries.map((query) => query.sql)),
      ...Object.values(SOURCE_EXISTENCE_SQL),
    ];
    for (const sql of statements) {
      const views = viewsRead(sql);
      expect(sql.trim().length).toBeGreaterThan(0);
      expect(views.length, sql).toBeGreaterThan(0);
      for (const view of views) expect(CATALOG_VIEWS, sql).toContain(view);
    }
  });

  /** @scenario "AC5 Status tiles compare with the previous period" */
  it("binds every period statement to the page period, never a fixed window", () => {
    for (const block of BLOCK_REGISTRY) {
      for (const query of block.queries) {
        expect(query.sql, block.id).toContain("{dashboard_context_period_start:DateTime}");
        expect(query.sql, block.id).toContain("{dashboard_context_period_end:DateTime}");
      }
    }
  });

  it("lists the ten Flight Deck panels in prototype order and width", () => {
    expect(FLIGHT_DECK_BLOCKS.map((block) => [block.title, block.width])).toEqual([
      ["Status", "full"],
      ["Throughput, latency & errors", "full"],
      ["Cost efficiency", "half"],
      ["Failure intelligence", "half"],
      ["Scenario results", "half"],
      ["Quality signal", "half"],
      ["User feedback", "half"],
      ["Gateway routing", "half"],
      ["Your coding agents", "full"],
      ["Most impactful traces", "full"],
    ]);
  });
});

describe("blockState", () => {
  const connected = { sourceStatus: "success", connected: true } as const;

  it("is empty when a connected source answers no rows for the period", () => {
    expect(blockState({ ...connected, dataStatus: "success", hasRows: false })).toBe("empty");
  });

  it("is an error, not empty and not a call to action, when the statement fails", () => {
    expect(blockState({ ...connected, dataStatus: "error", hasRows: false })).toBe("error");
  });

  it("invites the member to connect a source that never recorded a row", () => {
    expect(
      blockState({
        sourceStatus: "success",
        connected: false,
        dataStatus: "pending",
        hasRows: false,
      }),
    ).toBe("notConnected");
  });
});
