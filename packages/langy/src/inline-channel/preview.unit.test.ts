import { describe, expect, it } from "vitest";

import {
  feedLangyDerivedCardPreview,
  initialLangyDerivedCardPreview,
  reconcileLangyDerivedCardPreviews,
  type LangyDerivedCardPreview,
} from "./preview";

/** Feed a sequence of cumulative buffers, as the stream would. */
function feedAll(chunks: string[]): LangyDerivedCardPreview {
  return chunks.reduce<LangyDerivedCardPreview>(
    (state, raw) => feedLangyDerivedCardPreview(state, raw),
    initialLangyDerivedCardPreview,
  );
}

describe("feedLangyDerivedCardPreview", () => {
  describe("when a timeseries block streams in chunks", () => {
    // The card draws itself while the block streams: a forming card renders
    // once enough has arrived to validate, and grows as points arrive.
    const opening = '{"kind": "timeseries", "blockId": "b1", "series": [';
    const firstSeries = `${opening}{"name": "cost", "points": [{"t": "d1", "v": 1}`;
    const secondPoint = `${firstSeries}, {"t": "d2", "v": 2}`;

    it("shows no preview until a validating prefix exists", () => {
      const state = feedAll(['{"kind": "time', opening]);
      expect(state.card).toBeNull();
    });

    it("renders the forming card once the prefix validates", () => {
      const state = feedAll(['{"kind": "time', opening, firstSeries]);
      expect(state.card).not.toBeNull();
      expect(state.card?.kind).toBe("timeseries");
      if (state.card?.kind === "timeseries") {
        expect(state.card.series[0]!.points).toHaveLength(1);
      }
    });

    it("grows the card as points arrive", () => {
      const state = feedAll([opening, firstSeries, secondPoint]);
      if (state.card?.kind !== "timeseries") {
        throw new Error("expected a timeseries preview");
      }
      expect(state.card.series[0]!.points).toHaveLength(2);
    });
  });

  describe("when a later chunk momentarily breaks validation", () => {
    it("keeps the last validating block — never a non-validating guess", () => {
      const good =
        '{"kind": "stats", "blockId": "b1", "items": [{"label": "a", "value": 1}';
      // The next buffer is mid-way through a new item whose label has not
      // arrived: the item object is dropped by salvage, items still valid —
      // so contrive a buffer that truly fails: kind flips to garbage.
      const withGood = feedAll([good]);
      expect(withGood.card?.kind).toBe("stats");

      const broken = feedLangyDerivedCardPreview(
        withGood,
        '{"kind": "st',
      );
      expect(broken.card).toEqual(withGood.card);
      expect(broken.raw).toBe('{"kind": "st');
    });
  });

  describe("when a block never reaches a validating shape", () => {
    it("never shows a preview", () => {
      const state = feedAll(["not json", "not json at all"]);
      expect(state.card).toBeNull();
    });
  });

  describe("when fed the same buffer twice", () => {
    it("returns the same state object (no churn)", () => {
      const raw =
        '{"kind": "stats", "blockId": "b1", "items": [{"label": "a", "value": 1}]}';
      const first = feedLangyDerivedCardPreview(undefined, raw);
      const second = feedLangyDerivedCardPreview(first, raw);
      expect(second).toBe(first);
    });
  });
});

describe("reconcileLangyDerivedCardPreviews", () => {
  const preview = (blockId: string): LangyDerivedCardPreview => ({
    raw: "…",
    card: {
      kind: "stats",
      blockId,
      items: [{ label: "a", value: 1 }],
    },
  });

  describe("when the turn settles and stamped parts arrive", () => {
    it("drops the preview the settled part replaces — exactly one card", () => {
      const kept = reconcileLangyDerivedCardPreviews({
        previews: [preview("b1"), preview("b2")],
        settledCardIds: new Set(["b1"]),
      });
      expect(kept.map((p) => p.card?.blockId)).toEqual(["b2"]);
    });

    it("keeps a not-yet-validating preview only until its fence settles", () => {
      const forming: LangyDerivedCardPreview = { raw: '{"kind', card: null };
      const kept = reconcileLangyDerivedCardPreviews({
        previews: [forming],
        settledCardIds: new Set(["b1"]),
      });
      // A null-block preview has no id to reconcile by; it stays until the
      // caller clears previews at settle (settled parts always win).
      expect(kept).toEqual([forming]);
    });
  });
});
