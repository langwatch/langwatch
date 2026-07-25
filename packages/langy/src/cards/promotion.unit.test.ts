import { describe, expect, it } from "vitest";
import {
  assertTotalOrder,
  CARD_PROBES,
  promoteCard,
  type CardProbe,
} from "./registry.js";
import { toCliToolResult } from "./tool-result.js";

const promote = (nominal: Parameters<typeof promoteCard>[0]["nominal"], payload: unknown) =>
  promoteCard({ nominal, payload, probes: CARD_PROBES });

describe("promoteCard", () => {
  describe("given a generic read whose payload carries cost", () => {
    it("promotes it to the spend card", () => {
      expect(promote("resourceRead", { totalCost: 12.5 })).toBe("spend");
      expect(promote("resourceRead", { total_cost: 12.5 })).toBe("spend");
    });

    it("promotes a trace page whose rows each carry a cost", () => {
      expect(
        promote("resourceRead", {
          traces: [{ metrics: { total_cost: 0.0182 } }],
        }),
      ).toBe("spend");
    });
  });

  describe("given a generic read whose payload carries a series over time", () => {
    it("promotes it to the timeseries card", () => {
      expect(
        promote("resourceRead", {
          series: [
            {
              name: "Total cost",
              points: [
                { t: "2026-07-15", v: 0.11 },
                { t: "2026-07-16", v: 0.28 },
              ],
            },
          ],
        }),
      ).toBe("timeseries");
    });

    it("outranks spend, so a cost TREND is drawn rather than totalled", () => {
      // The failure this exists to fix: `analytics query --metric total-cost`
      // carries both a series and cost totals, and landing on the spend card
      // printed the numbers it could have drawn.
      expect(
        promote("resourceRead", {
          totalCost: 0.39,
          series: [
            {
              name: "Total cost",
              points: [
                { t: "2026-07-15", v: 0.11 },
                { t: "2026-07-16", v: 0.28 },
              ],
            },
          ],
        }),
      ).toBe("timeseries");
    });

    it("refuses a single point — one reading is not a trend", () => {
      expect(
        promote("resourceRead", {
          series: [{ name: "Total cost", points: [{ t: "2026-07-15", v: 0.11 }] }],
        }),
      ).toBeNull();
    });

    it("refuses an unnamed series — half the product emits arrays of pairs", () => {
      expect(
        promote("resourceRead", {
          series: [
            {
              points: [
                { t: "2026-07-15", v: 0.11 },
                { t: "2026-07-16", v: 0.28 },
              ],
            },
          ],
        }),
      ).toBeNull();
    });
  });

  describe("given a payload that merely has numbers in it", () => {
    it("is left alone — 'has numbers' is not evidence of spend", () => {
      expect(promote("resourceRead", { count: 9, latency: 120 })).toBeNull();
      expect(promote("resourceRead", { data: [1, 2, 3] })).toBeNull();
    });
  });

  describe("given a card the registry chose deliberately", () => {
    it("never overrides it, however tempting the payload", () => {
      // A trace page carries cost, but `trace search` means traces.
      const payload = { traces: [{ metrics: { total_cost: 1 } }] };
      expect(promote("traces", payload)).toBeNull();
      expect(promote("evalRun", payload)).toBeNull();
    });

    it("never demotes a write card", () => {
      expect(promote("resourceCreated", { totalCost: 3 })).toBeNull();
      expect(promote("resourceRemoved", { totalCost: 3 })).toBeNull();
    });
  });

  describe("given a card that is a resource's DEFAULT rather than a decision", () => {
    it("promotes the analytics default, which is how a trend reaches its plot", () => {
      // `analytics` declares `read: "metrics"` — a default over its whole verb
      // set, not a `byVerb` binding. While it was ineligible, `analytics query`
      // was the only command that emits a series and the only one that could
      // never be promoted, so the timeseries card was unreachable.
      expect(
        promote("metrics", {
          series: [
            {
              name: "Total cost",
              points: [
                { t: "2026-07-15", v: 0.11 },
                { t: "2026-07-16", v: 0.28 },
              ],
            },
          ],
        }),
      ).toBe("timeseries");
    });

    it("still keeps it when the payload earns nothing richer", () => {
      expect(
        promote("metrics", { currentPeriod: [{ date: 1 }], previousPeriod: [] }),
      ).toBeNull();
    });
  });

  describe("given a payload eligible for more than one card", () => {
    it("takes the most specific, not the first declared", () => {
      // Carries BOTH graph definitions and a cost total. Dashboard scores
      // higher, so it wins regardless of probe order.
      const both = { graphs: [{}], totalCost: 4 };
      expect(promote("resourceRead", both)).toBe("dashboard");
    });
  });

  describe("given nothing recognisable", () => {
    it("keeps the card the command's name earned", () => {
      expect(promote("resourceRead", { name: "anything" })).toBeNull();
      expect(promote("resourceRead", "a string")).toBeNull();
      expect(promote("resourceRead", null)).toBeNull();
    });
  });
});

describe("assertTotalOrder", () => {
  it("accepts the shipped probes", () => {
    expect(() => assertTotalOrder(CARD_PROBES)).not.toThrow();
  });

  it("rejects two probes claiming the same specificity", () => {
    // The bug this guards: a tie resolves by array order, so it holds until
    // someone reorders a literal and then silently renders a different card.
    const clashing: CardProbe[] = [
      { ...CARD_PROBES[0]!, specificity: 1 },
      { ...CARD_PROBES[1]!, specificity: 1 },
    ];
    expect(() => assertTotalOrder(clashing)).toThrow(/totally ordered/);
  });
});

describe("toCliToolResult", () => {
  describe("given a command whose payload carries a trend", () => {
    it("stamps the promoted card into the transport", () => {
      // The real answer `analytics query --metric total-cost` returns: the raw
      // analytics buckets, the resolved metric, and the card-shaped view the
      // command derives from them (see the CLI's `timeseriesShape.ts`).
      const result = toCliToolResult({
        resource: "analytics",
        verb: "query",
        payload: {
          currentPeriod: [
            { date: 1_752_364_800_000, "0/performance.total_cost/sum": 0.11 },
            { date: 1_752_451_200_000, "0/performance.total_cost/sum": 0.28 },
          ],
          previousPeriod: [],
          metric: "performance.total_cost",
          aggregation: "sum",
          series: [
            {
              name: "Total cost",
              points: [
                { t: "2026-07-13", v: 0.11 },
                { t: "2026-07-14", v: 0.28 },
              ],
            },
          ],
          title: "Total cost",
          unit: "usd",
        },
      });
      expect(result).toMatchObject({ kind: "card", card: "timeseries" });
    });
  });

  describe("given a listing that carries no trend and no total", () => {
    it("keeps the card its name earned", () => {
      // What `virtual-keys list` really answers with: an array of keys. The
      // list model carries no cost at all — nothing here earns the spend card,
      // and inventing a `{ totalCost }` payload for it only tested the probe
      // against a document the command cannot produce.
      const result = toCliToolResult({
        resource: "virtual-keys",
        verb: "list",
        payload: [
          {
            id: "vk_1",
            name: "checkout-agent",
            environment: "live",
            prefix: "lw_vk_live",
            last_four: "9f2c",
            status: "ACTIVE",
            scopes: [{ scope_type: "PROJECT", scope_id: "p_demo" }],
          },
        ],
      });
      expect(result).toMatchObject({ kind: "card", card: "resourceRead" });
    });
  });

  describe("given a payload that matches nothing", () => {
    it("still lands on the card it always did", () => {
      const result = toCliToolResult({
        resource: "annotation",
        verb: "list",
        payload: { data: [{ id: "a" }] },
      });
      expect(result).toMatchObject({ kind: "card", card: "resourceRead" });
    });
  });

  describe("given a deliberate per-verb binding", () => {
    it("keeps it — `evaluator get` is a config card by decision, not by shape", () => {
      const result = toCliToolResult({
        resource: "evaluator",
        verb: "get",
        payload: { enabled: true, name: "faithfulness" },
      });
      expect(result).toMatchObject({ kind: "card", card: "evaluatorConfig" });
    });
  });
});
