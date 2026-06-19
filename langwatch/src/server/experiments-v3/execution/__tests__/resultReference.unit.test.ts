import { describe, expect, it } from "vitest";
import { generateCells } from "../orchestrator";
import {
  RESERVED_DATASET_ID_KEY,
  RESERVED_ROW_ID_KEY,
  isReservedResultKey,
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
