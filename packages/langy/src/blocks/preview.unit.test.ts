import { describe, expect, it } from "vitest";

import {
  feedLangyCardBlockPreview,
  initialLangyCardBlockPreview,
  reconcileLangyCardBlockPreviews,
  type LangyCardBlockPreview,
} from "./preview";

/** Feed a sequence of cumulative buffers, as the stream would. */
function feedAll(chunks: string[]): LangyCardBlockPreview {
  return chunks.reduce<LangyCardBlockPreview>(
    (state, raw) => feedLangyCardBlockPreview(state, raw),
    initialLangyCardBlockPreview,
  );
}

describe("feedLangyCardBlockPreview", () => {
  describe("when a timeseries block streams in chunks", () => {
    // The card draws itself while the block streams: a forming card renders
    // once enough has arrived to validate, and grows as points arrive.
    const opening = '{"kind": "timeseries", "blockId": "b1", "series": [';
    const firstSeries = `${opening}{"name": "cost", "points": [{"t": "d1", "v": 1}`;
    const secondPoint = `${firstSeries}, {"t": "d2", "v": 2}`;

    it("shows no preview until a validating prefix exists", () => {
      const state = feedAll(['{"kind": "time', opening]);
      expect(state.block).toBeNull();
    });

    it("renders the forming card once the prefix validates", () => {
      const state = feedAll(['{"kind": "time', opening, firstSeries]);
      expect(state.block).not.toBeNull();
      expect(state.block?.kind).toBe("timeseries");
      if (state.block?.kind === "timeseries") {
        expect(state.block.series[0]!.points).toHaveLength(1);
      }
    });

    it("grows the card as points arrive", () => {
      const state = feedAll([opening, firstSeries, secondPoint]);
      if (state.block?.kind !== "timeseries") {
        throw new Error("expected a timeseries preview");
      }
      expect(state.block.series[0]!.points).toHaveLength(2);
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
      expect(withGood.block?.kind).toBe("stats");

      const broken = feedLangyCardBlockPreview(
        withGood,
        '{"kind": "st',
      );
      expect(broken.block).toEqual(withGood.block);
      expect(broken.raw).toBe('{"kind": "st');
    });
  });

  describe("when a block never reaches a validating shape", () => {
    it("never shows a preview", () => {
      const state = feedAll(["not json", "not json at all"]);
      expect(state.block).toBeNull();
    });
  });

  describe("when fed the same buffer twice", () => {
    it("returns the same state object (no churn)", () => {
      const raw =
        '{"kind": "stats", "blockId": "b1", "items": [{"label": "a", "value": 1}]}';
      const first = feedLangyCardBlockPreview(undefined, raw);
      const second = feedLangyCardBlockPreview(first, raw);
      expect(second).toBe(first);
    });
  });
});

describe("reconcileLangyCardBlockPreviews", () => {
  const preview = (blockId: string): LangyCardBlockPreview => ({
    raw: "…",
    block: {
      kind: "stats",
      blockId,
      items: [{ label: "a", value: 1 }],
    },
  });

  describe("when the turn settles and stamped parts arrive", () => {
    it("drops the preview the settled part replaces — exactly one card", () => {
      const kept = reconcileLangyCardBlockPreviews({
        previews: [preview("b1"), preview("b2")],
        settledBlockIds: new Set(["b1"]),
      });
      expect(kept.map((p) => p.block?.blockId)).toEqual(["b2"]);
    });

    it("keeps a not-yet-validating preview only until its fence settles", () => {
      const forming: LangyCardBlockPreview = { raw: '{"kind', block: null };
      const kept = reconcileLangyCardBlockPreviews({
        previews: [forming],
        settledBlockIds: new Set(["b1"]),
      });
      // A null-block preview has no id to reconcile by; it stays until the
      // caller clears previews at settle (settled parts always win).
      expect(kept).toEqual([forming]);
    });
  });
});
