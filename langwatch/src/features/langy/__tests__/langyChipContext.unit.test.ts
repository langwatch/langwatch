import { describe, expect, it } from "vitest";
import { SELECT_ALL_MATCHING_CAP } from "../../traces-v2/stores/selectionStore";
import { selectionContextChip } from "../hooks/useLangySelectionContext";
import { describeChipContext } from "../logic/langyChipContext";
import type { LangyContextChip } from "../stores/langyStore";

/** Every kind the chip vocabulary has, so none can be added without copy. */
const ALL_KINDS: LangyContextChip["kind"][] = [
  "project",
  "experiment",
  "trace",
  "prompt",
  "dataset",
  "dashboard",
  "scenario",
  "evaluation",
  "selection",
  "filter",
];

describe("describeChipContext", () => {
  describe("given the user asks what a chip is actually giving Langy", () => {
    describe("when the chip is a search", () => {
      it("says Langy gets the SEARCH, not a frozen list of results", () => {
        // The ambiguity the whole module exists to settle. A search hands over
        // the query: Langy can run it, so it gets the rows too, plus the ability
        // to widen or narrow it. Handing over rows alone would keep only the
        // part it could have derived for itself.
        const explanation = describeChipContext({
          id: "filter:error",
          kind: "filter",
          label: "filtered: errors",
          ref: 'status:"error"',
        });

        expect(explanation.action).toBe(
          "Langy gets the search itself, so it can run it, narrow it, or count what it matches.",
        );
      });

      it("shows the search that will be handed over", () => {
        expect(
          describeChipContext({
            id: "filter:error",
            kind: "filter",
            label: "filtered: errors",
            ref: 'status:"error"',
          }).payload,
        ).toBe('status:"error"');
      });
    });

    describe("when the chip is a hand-picked set of rows", () => {
      it("says Langy gets exactly those traces and nothing else", () => {
        const chip = selectionContextChip({
          mode: "explicit",
          traceIds: new Set(["trace_a", "trace_b", "trace_c"]),
        })!;

        expect(describeChipContext(chip).action).toBe(
          "Langy gets exactly these 3 traces, and works from those and nothing else.",
        );
      });

      it("names the traces, so the count can be checked rather than trusted", () => {
        const chip = selectionContextChip({
          mode: "explicit",
          traceIds: new Set(["aaaaaaaaaaaa", "bbbbbbbbbbbb", "cccccccccccc"]),
        })!;

        expect(describeChipContext(chip).payload).toBe(
          "aaaaaa…aa, bbbbbb…bb, cccccc…cc",
        );
      });

      it("collapses a long list rather than spilling a hundred ids into a tooltip", () => {
        const ids = Array.from({ length: 20 }, (_, i) => `trace_${i}`);
        const chip = selectionContextChip({
          mode: "explicit",
          traceIds: new Set(ids),
        })!;

        expect(describeChipContext(chip).payload).toContain("and 17 more");
      });
    });

    describe("when a single row is picked", () => {
      it("drops the plural instead of saying '1 traces'", () => {
        const chip = selectionContextChip({
          mode: "explicit",
          traceIds: new Set(["trace_a"]),
        })!;

        expect(describeChipContext(chip).action).toBe(
          "Langy will read this trace, start to finish.",
        );
      });
    });
  });

  describe("given the user selected everything their search matches", () => {
    describe("when a search is active", () => {
      it("says Langy gets the search, because there is no fixed list to give", () => {
        const chip = selectionContextChip({
          mode: "all-matching",
          traceIds: new Set(),
          queryText: 'status:"error"',
        })!;

        expect(describeChipContext(chip).action).toBe(
          `Langy gets your search, not a fixed list, so it works from everything the search matches (up to ${SELECT_ALL_MATCHING_CAP.toLocaleString()} traces).`,
        );
        expect(describeChipContext(chip).payload).toBe('status:"error"');
      });
    });

    describe("when no search is active", () => {
      it("says it is everything in the time range, and does not invent a query", () => {
        const chip = selectionContextChip({
          mode: "all-matching",
          traceIds: new Set(),
          queryText: "",
        })!;

        expect(describeChipContext(chip).action).toBe(
          `Langy works from every trace in the time range you are looking at (up to ${SELECT_ALL_MATCHING_CAP.toLocaleString()}).`,
        );
        expect(describeChipContext(chip).payload).toBeUndefined();
      });
    });
  });

  describe("given every chip kind the vocabulary has", () => {
    describe("when its hover is built", () => {
      it("has copy for all of them, so a new kind cannot ship silent", () => {
        for (const kind of ALL_KINDS) {
          const explanation = describeChipContext({
            id: `${kind}:x`,
            kind,
            label: kind,
            ref: "x",
          });

          expect(explanation.action.length).toBeGreaterThan(0);
        }
      });

      it("never leaks how it is built", () => {
        // The copy rules: say what it does for the user, never how it is built.
        for (const kind of ALL_KINDS) {
          const { action } = describeChipContext({
            id: `${kind}:x`,
            kind,
            label: kind,
            ref: "x",
          });

          expect(action).not.toMatch(
            /\b(ref|chip|payload|liqe|context chip|serialize|API|endpoint)\b/i,
          );
          // House style: no em dashes.
          expect(action).not.toContain("—");
        }
      });
    });
  });
});
describe("selectionContextChip, for 'select all matching'", () => {
  describe("given there is no row list to send", () => {
    describe("when the chip is built", () => {
      it("carries the search the rows matched, not the name of the mode", () => {
        // It used to send the literal string "all-matching", which named the
        // MODE the user was in rather than the traces they meant. The agent
        // could do nothing with it.
        const chip = selectionContextChip({
          mode: "all-matching",
          traceIds: new Set(),
          queryText: 'status:"error"',
        })!;

        expect(chip.ref).toBe('all-matching:status:"error"');
        expect(chip.ref).not.toBe("all-matching");
      });

      it("re-surfaces as new context when the search changes", () => {
        const first = selectionContextChip({
          mode: "all-matching",
          traceIds: new Set(),
          queryText: 'status:"error"',
        })!;
        const second = selectionContextChip({
          mode: "all-matching",
          traceIds: new Set(),
          queryText: 'model:"gpt-4"',
        })!;

        // "everything matching X" and "everything matching Y" are not the same
        // context, so a dismissal of one must not silence the other.
        expect(first.id).not.toBe(second.id);
      });
    });
  });
});
