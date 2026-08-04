import { describe, expect, it } from "vitest";
import {
  formatEvalColumnId,
  isEvalColumnId,
  parseEvalColumnId,
} from "../../../lens/evalColumnId";
import type { TraceEvalResult, TraceListItem } from "../../../types/trace";
import {
  buildEvalColumnDef,
  evalColumnLabel,
  evalFieldValue,
  latestEvalForKey,
} from "../evalColumns";

function evalResult(over: Partial<TraceEvalResult>): TraceEvalResult {
  return {
    evaluatorId: "e1",
    evaluatorName: "Faithfulness",
    status: "processed",
    score: null,
    passed: null,
    label: null,
    ...over,
  };
}

function rowWith(evaluations: TraceEvalResult[]): TraceListItem {
  return { evaluations } as TraceListItem;
}

describe("eval column id grammar", () => {
  describe("when formatting and parsing round-trip", () => {
    it("encodes field-first and parses back", () => {
      const id = formatEvalColumnId({
        field: "score",
        evaluatorKey: "evaluator_abc",
      });
      expect(id).toBe("eval:score:evaluator_abc");
      expect(parseEvalColumnId(id)).toEqual({
        field: "score",
        evaluatorKey: "evaluator_abc",
      });
    });

    it("preserves an evaluator key that contains delimiters", () => {
      const id = formatEvalColumnId({
        field: "verdict",
        evaluatorKey: "ragas/faithfulness:v2",
      });
      expect(parseEvalColumnId(id)).toEqual({
        field: "verdict",
        evaluatorKey: "ragas/faithfulness:v2",
      });
    });
  });

  describe("when the id is not a valid eval column", () => {
    it("rejects non-eval ids", () => {
      expect(isEvalColumnId("cost")).toBe(false);
      expect(parseEvalColumnId("cost")).toBeNull();
    });

    it("rejects an unknown field token", () => {
      expect(parseEvalColumnId("eval:reasoning:e1")).toBeNull();
    });

    it("rejects an empty evaluator key", () => {
      expect(parseEvalColumnId("eval:score:")).toBeNull();
    });
  });
});

describe("evalColumnLabel", () => {
  describe("when the evaluator has a known name", () => {
    it("uses the name and the field label", () => {
      const names = new Map([["evaluator_abc", "Faithfulness"]]);
      expect(
        evalColumnLabel({
          field: "score",
          evaluatorKey: "evaluator_abc",
          evaluatorNames: names,
        }),
      ).toBe("Faithfulness · Score");
    });
  });

  describe("when the evaluator name is unknown", () => {
    it("falls back to the raw key", () => {
      expect(
        evalColumnLabel({ field: "label", evaluatorKey: "typed-thing" }),
      ).toBe("typed-thing · Label");
    });
  });
});

describe("latestEvalForKey", () => {
  describe("given multiple runs of the same evaluator", () => {
    describe("when looking up that evaluator's key", () => {
      it("returns the first match (the latest run)", () => {
        const row = rowWith([
          evalResult({ evaluatorId: "e1", score: 9.1 }),
          evalResult({ evaluatorId: "e1", score: 7.2 }),
        ]);
        expect(latestEvalForKey({ row, evaluatorKey: "e1" })?.score).toBe(9.1);
      });
    });
  });

  describe("when an id match and a same-name match both exist", () => {
    it("prefers the evaluator-id match over an earlier same-name run", () => {
      const row = rowWith([
        evalResult({ evaluatorId: "other", evaluatorName: "e1", score: 1 }),
        evalResult({ evaluatorId: "e1", evaluatorName: "Faith", score: 2 }),
      ]);
      // "e1" is a name on row 0 but the id on row 1 — id precedence wins.
      expect(latestEvalForKey({ row, evaluatorKey: "e1" })?.score).toBe(2);
    });
  });

  describe("when matching by name", () => {
    it("resolves a free-text name to its run", () => {
      const row = rowWith([
        evalResult({
          evaluatorId: "e9",
          evaluatorName: "Toxicity",
          passed: false,
        }),
      ]);
      expect(latestEvalForKey({ row, evaluatorKey: "Toxicity" })?.passed).toBe(
        false,
      );
    });
  });

  describe("when the evaluator has no run on the trace", () => {
    it("returns undefined", () => {
      expect(
        latestEvalForKey({ row: rowWith([]), evaluatorKey: "e1" }),
      ).toBeUndefined();
    });
  });
});

describe("evalFieldValue", () => {
  it("reads score / verdict / label off the matched run", () => {
    const ev = evalResult({ score: 8.2, passed: true, label: "Positive" });
    expect(evalFieldValue({ ev, field: "score" })).toBe(8.2);
    expect(evalFieldValue({ ev, field: "verdict" })).toBe(true);
    expect(evalFieldValue({ ev, field: "label" })).toBe("Positive");
  });

  it("is null when there is no run", () => {
    expect(evalFieldValue({ ev: undefined, field: "score" })).toBeNull();
  });
});

describe("buildEvalColumnDef", () => {
  it("carries the id, header label, and a non-sorting accessor over the field value", () => {
    const def = buildEvalColumnDef({
      id: "eval:score:e1",
      field: "score",
      evaluatorKey: "e1",
      label: "Faithfulness · Score",
    });
    expect(def.id).toBe("eval:score:e1");
    expect(def.header).toBe("Faithfulness · Score");
    expect(def.enableSorting).toBe(false);

    const row = rowWith([evalResult({ evaluatorId: "e1", score: 8.2 })]);
    const accessorFn = (
      def as { accessorFn?: (r: TraceListItem, i: number) => unknown }
    ).accessorFn;
    expect(accessorFn?.(row, 0)).toBe(8.2);
  });
});
