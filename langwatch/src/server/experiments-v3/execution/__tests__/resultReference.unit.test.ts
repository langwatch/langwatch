import { describe, expect, it } from "vitest";
import { generateCells } from "../orchestrator";
import {
  RESERVED_DATASET_ID_KEY,
  RESERVED_ROW_ID_KEY,
  RESULT_INLINE_BYTES,
  isReservedResultKey,
  leanResultEntry,
  readRowReference,
  withRowReference,
} from "../resultReference";
import type { ExecutionScope } from "../types";

describe("ADR-033 result-by-reference plumbing", () => {
  describe("withRowReference", () => {
    describe("given a row with a stable id", () => {
      it("attaches the dataset + row reference under the reserved namespace", () => {
        const entry = { question: "how many units?", expected: 5 };

        const withRef = withRowReference(entry, {
          datasetId: "ds-1",
          rowId: "record_abc",
        });

        expect(withRef[RESERVED_DATASET_ID_KEY]).toBe("ds-1");
        expect(withRef[RESERVED_ROW_ID_KEY]).toBe("record_abc");
        // light columns preserved
        expect(withRef.question).toBe("how many units?");
        expect(withRef.expected).toBe(5);
      });

      it("round-trips through readRowReference, project-scoped lookup key", () => {
        const withRef = withRowReference(
          { q: "x" },
          { datasetId: "ds-1", rowId: "record_abc" },
        );

        expect(readRowReference(withRef)).toEqual({
          datasetId: "ds-1",
          rowId: "record_abc",
        });
      });
    });

    describe("given a row with no stable id (inline / id-less)", () => {
      it("is a no-op so the result keeps today's full-copy shape", () => {
        const entry = { question: "x", image: "data:image/png;base64,AAAA" };

        const result = withRowReference(entry, {
          datasetId: "ds-1",
          rowId: undefined,
        });

        expect(result).toBe(entry); // same object, untouched
        expect(readRowReference(result)).toBeNull();
      });
    });
  });

  describe("leanResultEntry", () => {
    const heavyImage = `data:image/png;base64,${"A".repeat(RESULT_INLINE_BYTES + 1)}`;
    const row = { question: "how many units?", expected: 5, image: heavyImage };
    const ref = { datasetId: "ds-1", rowId: "record_abc" };

    describe("when the streaming-reads flag is ON and the row has an id", () => {
      const lean = leanResultEntry(row, ref, { enabled: true });

      it("keeps light columns inline", () => {
        expect(lean.question).toBe("how many units?");
        expect(lean.expected).toBe(5);
      });

      it("drops the heavy column, to be resolved at read by reference", () => {
        expect(lean.image).toBeUndefined();
        expect(readRowReference(lean)).toEqual({
          datasetId: "ds-1",
          rowId: "record_abc",
        });
      });
    });

    describe("when the flag is OFF", () => {
      it("keeps the full row byte-for-byte (I-COMPAT), reference still attached", () => {
        const full = leanResultEntry(row, ref, { enabled: false });
        expect(full.image).toBe(heavyImage); // heavy column NOT stripped
        expect(full.question).toBe("how many units?");
        expect(full[RESERVED_ROW_ID_KEY]).toBe("record_abc");
      });
    });

    describe("when the row has no stable id (inline dataset)", () => {
      it("keeps the full row even with the flag on", () => {
        const full = leanResultEntry(row, { rowId: undefined }, { enabled: true });
        expect(full.image).toBe(heavyImage);
        expect(readRowReference(full)).toBeNull();
      });
    });
  });

  describe("isReservedResultKey", () => {
    it("flags the reference keys and nothing else", () => {
      expect(isReservedResultKey(RESERVED_ROW_ID_KEY)).toBe(true);
      expect(isReservedResultKey(RESERVED_DATASET_ID_KEY)).toBe(true);
      expect(isReservedResultKey("question")).toBe(false);
    });
  });

  describe("generateCells row-id threading", () => {
    const state = {
      datasets: [{ id: "ds-1" }],
      activeDatasetId: "ds-1",
      targets: [{ id: "target-1", type: "prompt" }],
      evaluators: [],
    } as any;
    const datasetRows = [
      { question: "a", quantity: 1 },
      { question: "b", quantity: 2 },
    ];
    const scope: ExecutionScope = { type: "full" };

    describe("given saved-dataset row ids aligned by index", () => {
      it("threads each row's stable id onto its cell", () => {
        const cells = generateCells(state, datasetRows, scope, [
          "record_a",
          "record_b",
        ]);

        expect(cells).toHaveLength(2);
        expect(cells[0]?.rowId).toBe("record_a");
        expect(cells[1]?.rowId).toBe("record_b");
      });
    });

    describe("given no row ids (inline dataset)", () => {
      it("leaves rowId undefined on every cell", () => {
        const cells = generateCells(state, datasetRows, scope, undefined);

        expect(cells.every((c) => c.rowId === undefined)).toBe(true);
      });
    });
  });
});
