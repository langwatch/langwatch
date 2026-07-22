import { describe, expect, it } from "vitest";

import {
  DERIVED_SAFE_CARD_KINDS,
  isDerivedSafeCardKind,
  langyDerivedCardSchema,
  langyDerivedChoicesCardSchema,
  type DerivedSafeCardKind,
} from "./derived-safe.js";
import { CARD_KINDS, CARD_SHAPE } from "./schemas.js";

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

/**
 * One valid sample per allowlisted kind. Typed as a total record so that
 * adding a kind to the allowlist without a sample fails to compile — the
 * tests below walk the allowlist, and a missing sample would otherwise skip
 * the new kind silently.
 */
const SAMPLE_BY_KIND: Record<DerivedSafeCardKind, unknown> = {
  timeseries,
  table,
  stats,
  choices,
};

describe("langyDerivedCardSchema", () => {
  describe("given each allowlisted kind", () => {
    it.each([
      ["timeseries", timeseries],
      ["table", table],
      ["stats", stats],
      ["choices", choices],
    ])("validates a %s card", (_kind, block) => {
      const parsed = langyDerivedCardSchema.safeParse(block);
      expect(parsed.success).toBe(true);
    });
  });

  describe("given a resource-shaped kind", () => {
    // ADR-060 §3: a model that can emit a traces card can assert records
    // that were never searched for. The allowlist is closed.
    //
    // Driven off the SHARED kind list rather than a hand-written sample, so a
    // kind added to the vocabulary is covered the day it is added — that is
    // the failure this whole merge had to not introduce. `CARD_SHAPE` decides
    // which kinds belong here, so a re-classification (the only way to widen
    // the allowlist past the type gates) shows up as a failure right here.
    const resourceShaped = CARD_KINDS.filter(
      (kind) => CARD_SHAPE[kind] === "resource",
    );

    it.each(resourceShaped)("refuses kind %s", (kind) => {
      const parsed = langyDerivedCardSchema.safeParse({ ...stats, kind });
      expect(parsed.success).toBe(false);
    });

    it("refuses every one of them — and there is at least one to refuse", () => {
      // Guards the guard: an empty list above would pass vacuously.
      expect(resourceShaped.length).toBeGreaterThan(0);
      for (const kind of resourceShaped) {
        expect(
          DERIVED_SAFE_CARD_KINDS as readonly string[],
          `${kind} asserts records exist — it must never be model-emittable`,
        ).not.toContain(kind);
        expect(isDerivedSafeCardKind(kind)).toBe(false);
      }
    });
  });

  describe("given the allowlist itself", () => {
    it("names only kinds the shared vocabulary knows", () => {
      for (const kind of DERIVED_SAFE_CARD_KINDS) {
        expect(CARD_KINDS as readonly string[]).toContain(kind);
      }
    });

    it("is a STRICT subset — the whole list is never derived-safe", () => {
      expect(DERIVED_SAFE_CARD_KINDS.length).toBeLessThan(CARD_KINDS.length);
    });

    it("names only presentation-shaped kinds", () => {
      for (const kind of DERIVED_SAFE_CARD_KINDS) {
        expect(CARD_SHAPE[kind]).toBe("presentation");
      }
    });

    it("classifies every kind in the vocabulary", () => {
      // The runtime reading of `satisfies Record<CardKind, CardShape>`: a kind
      // that slipped in unclassified (via a cast, or a `@ts-expect-error`)
      // would otherwise reach the allowlist's type gate as `never` and be
      // silently uncheckable.
      for (const kind of CARD_KINDS) {
        expect(
          CARD_SHAPE[kind],
          `${kind} is unclassified — say whether it asserts records exist`,
        ).toMatch(/^(resource|presentation)$/);
      }
    });

    it("validates each allowlisted kind against a schema of its own", () => {
      // Gate 3 at runtime: an allowlisted kind with no strict schema would
      // fall through the discriminated union and refuse everything, which
      // reads as "the model emitted nothing" rather than as a missing schema.
      for (const kind of DERIVED_SAFE_CARD_KINDS) {
        const sample = SAMPLE_BY_KIND[kind];
        expect(langyDerivedCardSchema.safeParse(sample).success).toBe(true);
      }
    });
  });

  describe("given a card without a blockId", () => {
    it.each([
      ["timeseries", timeseries],
      ["table", table],
      ["stats", stats],
      ["choices", choices],
    ])("refuses the %s card", (_kind, block) => {
      const { blockId: _dropped, ...withoutId } = block as Record<
        string,
        unknown
      >;
      expect(langyDerivedCardSchema.safeParse(withoutId).success).toBe(false);
    });
  });

  describe("given structurally wrong payloads", () => {
    it("refuses a timeseries with no series", () => {
      expect(
        langyDerivedCardSchema.safeParse({
          ...timeseries,
          series: [],
        }).success,
      ).toBe(false);
    });

    it("refuses a timeseries whose points are not numbers", () => {
      expect(
        langyDerivedCardSchema.safeParse({
          ...timeseries,
          series: [{ name: "cost", points: [{ t: "d1", v: "1.2" }] }],
        }).success,
      ).toBe(false);
    });

    it("refuses a table whose cells are nested structures", () => {
      expect(
        langyDerivedCardSchema.safeParse({
          ...table,
          rows: [[{ nested: true }]],
        }).success,
      ).toBe(false);
    });

    it("refuses stats with an empty items list", () => {
      expect(
        langyDerivedCardSchema.safeParse({ ...stats, items: [] }).success,
      ).toBe(false);
    });

    it("accepts a ragged table row rather than failing the block", () => {
      expect(
        langyDerivedCardSchema.safeParse({
          ...table,
          rows: [["only-one-cell"]],
        }).success,
      ).toBe(true);
    });
  });

  describe("given affordance hints", () => {
    it("accepts hints from the closed vocabulary", () => {
      const parsed = langyDerivedCardSchema.safeParse({
        ...timeseries,
        hints: [
          { type: "explore", query: { filter: "llm.model == gpt-5-mini" } },
          { type: "verify" },
        ],
      });
      expect(parsed.success).toBe(true);
    });

    it("refuses a hint type outside the vocabulary", () => {
      const parsed = langyDerivedCardSchema.safeParse({
        ...timeseries,
        hints: [{ type: "navigate", url: "https://example.com" }],
      });
      expect(parsed.success).toBe(false);
    });
  });
});

describe("langyDerivedChoicesCardSchema", () => {
  describe("given duplicate option ids", () => {
    it("refuses the card — the recorded answer would be ambiguous", () => {
      const parsed = langyDerivedChoicesCardSchema.safeParse({
        ...choices,
        options: [
          { id: "same", label: "One" },
          { id: "same", label: "Two" },
        ],
      });
      expect(parsed.success).toBe(false);
    });

    it("refuses duplicates through the union schema too", () => {
      const parsed = langyDerivedCardSchema.safeParse({
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
    it("refuses the card", () => {
      expect(
        langyDerivedChoicesCardSchema.safeParse({ ...choices, options: [] }).success,
      ).toBe(false);
    });
  });

  describe("given a ref missing its id", () => {
    it("refuses the card", () => {
      expect(
        langyDerivedChoicesCardSchema.safeParse({
          ...choices,
          options: [{ id: "x", label: "X", ref: { type: "agent" } }],
        }).success,
      ).toBe(false);
    });
  });
});
