import { describe, expect, it } from "vitest";
import {
  mergeContextChips,
  shortenChipId,
  traceContextChip,
} from "../logic/langyContextChips";
import {
  type LangyContextChip,
  selectDismissedChips,
  selectVisibleChips,
} from "../stores/langyStore";

/** The chip Langy derives for itself from the open drawer / the route. */
const autoDerivedTrace: LangyContextChip = traceContextChip("abc123def456");

/** The chip the same trace mints when the user clicks its row in the table. */
const pickedTrace: LangyContextChip = traceContextChip("abc123def456");

const pickedEvaluation: LangyContextChip = {
  id: "evaluation:mon_1",
  kind: "evaluation",
  label: "evaluation: latency check",
  ref: "mon_1",
};

const filterChip: LangyContextChip = {
  id: 'filter:status:"error"',
  kind: "filter",
  label: 'filtered: status:"error"',
  ref: 'status:"error"',
};

describe("mergeContextChips", () => {
  describe("given a target the user clicked and one Langy derived on its own", () => {
    describe("when both name the same resource", () => {
      it("collapses them into a single chip", () => {
        const merged = mergeContextChips([autoDerivedTrace, pickedTrace]);

        expect(merged).toHaveLength(1);
        expect(merged[0]!.id).toBe("trace:abc123def456");
      });

      it("keeps the auto-derived chip, which is passed first", () => {
        const routed = { ...autoDerivedTrace, label: "trace abc123…56" };
        const clicked = { ...pickedTrace, label: "a worse label" };

        const merged = mergeContextChips([routed, clicked]);

        expect(merged[0]!.label).toBe("trace abc123…56");
      });
    });

    describe("when they name different resources", () => {
      it("keeps both, in source order", () => {
        const merged = mergeContextChips([
          autoDerivedTrace,
          filterChip,
          pickedEvaluation,
        ]);

        expect(merged.map((chip) => chip.id)).toEqual([
          "trace:abc123def456",
          'filter:status:"error"',
          "evaluation:mon_1",
        ]);
      });
    });
  });

  describe("given a source that produced nothing", () => {
    describe("when it is merged", () => {
      it("skips the empty slots", () => {
        const merged = mergeContextChips([
          null,
          autoDerivedTrace,
          undefined,
          null,
        ]);

        expect(merged).toEqual([autoDerivedTrace]);
      });
    });
  });

  describe("given the user dismissed a chip", () => {
    describe("when the same chip is still produced by its source", () => {
      it("hides it from the composer", () => {
        const candidates = mergeContextChips([
          autoDerivedTrace,
          pickedEvaluation,
        ]);
        const dismissed = new Set(["trace:abc123def456"]);

        expect(
          selectVisibleChips(candidates, dismissed).map((chip) => chip.id),
        ).toEqual(["evaluation:mon_1"]);
      });

      it("offers it back through the '+ context' control", () => {
        const candidates = mergeContextChips([
          autoDerivedTrace,
          pickedEvaluation,
        ]);
        const dismissed = new Set(["trace:abc123def456"]);

        expect(
          selectDismissedChips(candidates, dismissed).map((chip) => chip.id),
        ).toEqual(["trace:abc123def456"]);
      });
    });

    describe("when the user then clicks that same target on the page", () => {
      it("shows the chip again once the dismissal is lifted", () => {
        const candidates = mergeContextChips([autoDerivedTrace, pickedTrace]);
        // Clicking a target calls `restoreChip`, which clears the dismissal.
        const dismissed = new Set<string>();

        expect(
          selectVisibleChips(candidates, dismissed).map((chip) => chip.id),
        ).toEqual(["trace:abc123def456"]);
      });
    });
  });
});

describe("traceContextChip", () => {
  describe("given a trace id", () => {
    describe("when a row, a drawer and a route each mint a chip for it", () => {
      it("produces an identical chip every time, so the three dedupe", () => {
        expect(traceContextChip("abc123def456")).toEqual({
          id: "trace:abc123def456",
          kind: "trace",
          label: "trace abc123…56",
          ref: "abc123def456",
        });
      });
    });
  });
});

describe("shortenChipId", () => {
  describe("given a long id", () => {
    describe("when it is put on a chip", () => {
      it("elides the middle", () => {
        expect(shortenChipId("abc123def456")).toBe("abc123…56");
      });
    });
  });

  describe("given a short id", () => {
    describe("when it is put on a chip", () => {
      it("leaves it whole", () => {
        expect(shortenChipId("abc123")).toBe("abc123");
      });
    });
  });
});
