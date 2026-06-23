/**
 * @vitest-environment jsdom
 *
 * The per-evaluator eval column cell renders the chosen field (Score /
 * Verdict / Label) of the evaluator's latest run on the trace, or an
 * em-dash when there is no run / no value.
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { EvalColumnField } from "../../../../../../lens/evalColumnId";
import type {
  TraceEvalResult,
  TraceListItem,
} from "../../../../../../types/trace";
import { makeEvalCellDef } from "../EvalResultCell";

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

function renderCell({
  evaluatorKey,
  field,
  evaluations,
}: {
  evaluatorKey: string;
  field: EvalColumnField;
  evaluations: TraceEvalResult[];
}) {
  const cell = makeEvalCellDef({
    id: `eval:${field}:${evaluatorKey}`,
    evaluatorKey,
    field,
  });
  const row = { evaluations } as TraceListItem;
  // Each test renders a fresh cell into document.body; without cleanup the
  // bound `getByText` (which searches the whole body) would see em-dashes
  // from previous renders and fail with "multiple elements".
  return render(
    <ChakraProvider value={defaultSystem}>
      {cell.render({ row } as unknown as Parameters<typeof cell.render>[0])}
    </ChakraProvider>,
  );
}

afterEach(cleanup);

describe("per-evaluator eval column cell", () => {
  describe("given the evaluator has a run on the trace", () => {
    describe("when the field is Score", () => {
      it("renders the formatted score", () => {
        const { getByText } = renderCell({
          evaluatorKey: "e1",
          field: "score",
          evaluations: [evalResult({ evaluatorId: "e1", score: 8.2 })],
        });
        expect(getByText("8.2")).toBeTruthy();
      });

      it("renders an em-dash when the run has no score", () => {
        const { getByText } = renderCell({
          evaluatorKey: "e1",
          field: "score",
          evaluations: [
            evalResult({ evaluatorId: "e1", status: "skipped", score: null }),
          ],
        });
        expect(getByText("—")).toBeTruthy();
      });
    });

    describe("when the field is Verdict", () => {
      it("renders Pass for a passed run", () => {
        const { getByText } = renderCell({
          evaluatorKey: "e1",
          field: "verdict",
          evaluations: [evalResult({ evaluatorId: "e1", passed: true })],
        });
        expect(getByText("Pass")).toBeTruthy();
      });

      it("renders Fail for a failed run", () => {
        const { getByText } = renderCell({
          evaluatorKey: "e1",
          field: "verdict",
          evaluations: [evalResult({ evaluatorId: "e1", passed: false })],
        });
        expect(getByText("Fail")).toBeTruthy();
      });
    });

    describe("when the field is Label", () => {
      it("renders the categorical label", () => {
        const { getByText } = renderCell({
          evaluatorKey: "e1",
          field: "label",
          evaluations: [evalResult({ evaluatorId: "e1", label: "Positive" })],
        });
        expect(getByText("Positive")).toBeTruthy();
      });
    });
  });

  describe("when the evaluator key matches a run by name (not id)", () => {
    it("resolves the run by evaluatorName and renders its value", () => {
      const { getByText } = renderCell({
        evaluatorKey: "Faithfulness",
        field: "score",
        evaluations: [
          evalResult({
            evaluatorId: "e1",
            evaluatorName: "Faithfulness",
            score: 7.4,
          }),
        ],
      });
      expect(getByText("7.4")).toBeTruthy();
    });
  });

  describe("when the trace has no run of the evaluator", () => {
    it("renders an em-dash", () => {
      const { getByText } = renderCell({
        evaluatorKey: "missing",
        field: "score",
        evaluations: [evalResult({ evaluatorId: "e1", score: 8.2 })],
      });
      expect(getByText("—")).toBeTruthy();
    });
  });
});
