import { describe, expect, it } from "vitest";

import { langyCardBlockSchema, langyChoicesBlockSchema } from "./schemas";

const timeseries = {
  kind: "timeseries",
  blockId: "b1",
  title: "Cost per day",
  unit: "usd",
  series: [
    {
      name: "cost",
      points: [
        { t: "2026-07-20", v: 1.2 },
        { t: "2026-07-21", v: 1.9 },
      ],
    },
  ],
};

const table = {
  kind: "table",
  blockId: "b2",
  columns: ["model", "count"],
  rows: [
    ["gpt-5-mini", 41],
    ["claude", 12],
  ],
};

const stats = {
  kind: "stats",
  blockId: "b3",
  items: [{ label: "p95 latency", value: 812, unit: "ms" }],
};

const choices = {
  kind: "choices",
  blockId: "b4",
  question: "Which agent should this scenario run against?",
  options: [
    { id: "staging", label: "Staging agent" },
    {
      id: "prod",
      label: "Production agent",
      description: "The live one",
      ref: { type: "agent", id: "agent_123" },
    },
  ],
  multiSelect: false,
  allowOther: true,
};

describe("langyCardBlockSchema", () => {
  describe("given each allowlisted kind", () => {
    it.each([
      ["timeseries", timeseries],
      ["table", table],
      ["stats", stats],
      ["choices", choices],
    ])("validates a %s block", (_kind, block) => {
      const parsed = langyCardBlockSchema.safeParse(block);
      expect(parsed.success).toBe(true);
    });
  });

  describe("given a resource-shaped kind", () => {
    // ADR-060 §3: a model that can emit a traces card can assert records
    // that were never searched for. The allowlist is closed.
    it.each([
      ["traces"],
      ["trace"],
      ["evalRun"],
      ["resourceCreated"],
      ["metrics"],
      ["dataset"],
    ])("refuses kind %s", (kind) => {
      const parsed = langyCardBlockSchema.safeParse({
        ...stats,
        kind,
      });
      expect(parsed.success).toBe(false);
    });
  });

  describe("given a block without a blockId", () => {
    it.each([
      ["timeseries", timeseries],
      ["table", table],
      ["stats", stats],
      ["choices", choices],
    ])("refuses the %s block", (_kind, block) => {
      const { blockId: _dropped, ...withoutId } = block as Record<
        string,
        unknown
      >;
      expect(langyCardBlockSchema.safeParse(withoutId).success).toBe(false);
    });
  });

  describe("given structurally wrong payloads", () => {
    it("refuses a timeseries with no series", () => {
      expect(
        langyCardBlockSchema.safeParse({
          ...timeseries,
          series: [],
        }).success,
      ).toBe(false);
    });

    it("refuses a timeseries whose points are not numbers", () => {
      expect(
        langyCardBlockSchema.safeParse({
          ...timeseries,
          series: [{ name: "cost", points: [{ t: "d1", v: "1.2" }] }],
        }).success,
      ).toBe(false);
    });

    it("refuses a table whose cells are nested structures", () => {
      expect(
        langyCardBlockSchema.safeParse({
          ...table,
          rows: [[{ nested: true }]],
        }).success,
      ).toBe(false);
    });

    it("refuses stats with an empty items list", () => {
      expect(
        langyCardBlockSchema.safeParse({ ...stats, items: [] }).success,
      ).toBe(false);
    });

    it("accepts a ragged table row rather than failing the block", () => {
      expect(
        langyCardBlockSchema.safeParse({
          ...table,
          rows: [["only-one-cell"]],
        }).success,
      ).toBe(true);
    });
  });

  describe("given affordance hints", () => {
    it("accepts hints from the closed vocabulary", () => {
      const parsed = langyCardBlockSchema.safeParse({
        ...timeseries,
        hints: [
          { type: "explore", query: { filter: "llm.model == gpt-5-mini" } },
          { type: "verify" },
        ],
      });
      expect(parsed.success).toBe(true);
    });

    it("refuses a hint type outside the vocabulary", () => {
      const parsed = langyCardBlockSchema.safeParse({
        ...timeseries,
        hints: [{ type: "navigate", url: "https://example.com" }],
      });
      expect(parsed.success).toBe(false);
    });
  });
});

describe("langyChoicesBlockSchema", () => {
  describe("given duplicate option ids", () => {
    it("refuses the block — the recorded answer would be ambiguous", () => {
      const parsed = langyChoicesBlockSchema.safeParse({
        ...choices,
        options: [
          { id: "same", label: "One" },
          { id: "same", label: "Two" },
        ],
      });
      expect(parsed.success).toBe(false);
    });

    it("refuses duplicates through the union schema too", () => {
      const parsed = langyCardBlockSchema.safeParse({
        ...choices,
        options: [
          { id: "same", label: "One" },
          { id: "same", label: "Two" },
        ],
      });
      expect(parsed.success).toBe(false);
    });
  });

  describe("given an empty options list", () => {
    it("refuses the block", () => {
      expect(
        langyChoicesBlockSchema.safeParse({ ...choices, options: [] }).success,
      ).toBe(false);
    });
  });

  describe("given a ref missing its id", () => {
    it("refuses the block", () => {
      expect(
        langyChoicesBlockSchema.safeParse({
          ...choices,
          options: [{ id: "x", label: "X", ref: { type: "agent" } }],
        }).success,
      ).toBe(false);
    });
  });
});
