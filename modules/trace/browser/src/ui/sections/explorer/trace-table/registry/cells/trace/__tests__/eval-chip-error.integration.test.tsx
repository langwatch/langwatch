// @vitest-environment jsdom
/**
 * The hover card an evaluator chip in the trace list reveals for an errored run.
 * @see modules/instant-eval/specs/instant-eval-judge-model.feature
 */
import { renderWithDesignSystem } from "@langwatch/design-system/testing";
import { cleanup, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";

import type { TraceEvalResult } from "../../../../../types/trace.ts";
import { EvalChip } from "../../../shared-chips.tsx";
import "@testing-library/jest-dom/vitest";

function erroredEval(over: Partial<TraceEvalResult>): TraceEvalResult {
  return {
    evaluatorId: "e1",
    evaluatorName: "Faithfulness",
    status: "error",
    score: null,
    passed: null,
    label: null,
    ...over,
  };
}

async function hoverCardOf(eval_: TraceEvalResult): Promise<HTMLElement> {
  renderWithDesignSystem(<EvalChip eval_={eval_} />);
  await userEvent.hover(screen.getAllByText("Faithfulness")[0]!);
  return (await screen.findByText("Status")).closest("[data-part='content']") as HTMLElement;
}

describe("hovering an evaluator chip in the trace list", () => {
  afterEach(() => cleanup());

  describe("given its run errored with a stored error text", () => {
    /** @scenario "Hovering an errored evaluator chip in the trace list shows its error text" */
    it("shows the status as error and the error text", async () => {
      const card = await hoverCardOf(erroredEval({ error: "free_budget_exhausted: spent" }));

      expect(card).toHaveTextContent("Error");
      expect(card).toHaveTextContent("free_budget_exhausted: spent");
    });
  });

  describe("given its run errored with no stored error text", () => {
    /** @scenario "An evaluator chip with no error text shows no error row" */
    it("shows the status as error and no error text", async () => {
      const card = await hoverCardOf(erroredEval({ error: null }));

      expect(card).toHaveTextContent("Error");
      expect(card.querySelector("[data-testid='eval-chip-error-text']")).toBeNull();
    });
  });
});
