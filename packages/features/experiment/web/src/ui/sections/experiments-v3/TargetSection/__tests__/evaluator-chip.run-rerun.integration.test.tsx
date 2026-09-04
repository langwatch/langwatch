// @vitest-environment jsdom
/**
 * What the evaluator chip's menu offers, per evaluator state.
 *
 * The three items are not independent: a pending evaluator offers "Run", one
 * that already has a result offers "Rerun" instead, and one that is mid-flight
 * offers neither — plus "Run on all rows", which is available whenever the
 * evaluator is not running and at least one row has a target output.
 *
 * "Run" and "Run on all rows" are rendered DISABLED rather than removed when
 * there is no target output to run against, so that the tooltip can say why;
 * the assertion below is that the item cannot be actioned.
 *
 * @see specs/features/evaluations-v3/evaluator-run-rerun-enhancements.feature
 */
import "@testing-library/jest-dom/vitest";

import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../../../behavior/experiments-v3/use-evaluator-name", () => ({
  useEvaluatorName: () => "Exact Match",
  useEvaluatorNames: () => new Map(),
  useCodeEvaluatorIds: () => new Set(),
}));

import type { EvaluatorConfig } from "../../../../../model/experiments-v3/types";
import { EvaluatorChip } from "../evaluator-chip";

const evaluator = {
  id: "evaluator_1",
  evaluatorType: "langevals/exact_match",
  inputs: [],
  mappings: {},
} as unknown as EvaluatorConfig;

const Wrapper = ({ children }: { children: React.ReactNode }) => (
  <ChakraProvider value={defaultSystem}>{children}</ChakraProvider>
);

/** Renders the chip and opens its menu, which is where every item lives. */
async function openMenu(props: {
  result?: unknown;
  isRunning?: boolean;
  hasTargetOutput?: boolean;
  hasAnyTargetOutputs?: boolean;
}) {
  render(
    <EvaluatorChip
      evaluator={evaluator}
      result={props.result ?? null}
      isRunning={props.isRunning ?? false}
      hasTargetOutput={props.hasTargetOutput ?? false}
      hasAnyTargetOutputs={props.hasAnyTargetOutputs ?? false}
      onEdit={vi.fn()}
      onRemove={vi.fn()}
      onRerun={vi.fn()}
      onRunOnAllRows={vi.fn()}
    />,
    { wrapper: Wrapper },
  );

  await userEvent.click(screen.getByRole("button"));
  return await screen.findByRole("menu");
}

/** The menu item by its label, or null when the menu does not carry one. */
function item(menu: HTMLElement, label: string): HTMLElement | null {
  return (Array.from(menu.querySelectorAll('[role="menuitem"]')).find((element) =>
    element.textContent?.trim().startsWith(label),
  ) ?? null) as HTMLElement | null;
}

/** Whether the item is offered to the caller at all. */
function isOffered(element: HTMLElement | null): boolean {
  return element !== null && element.getAttribute("data-disabled") === null;
}

describe("the evaluator chip menu", () => {
  afterEach(cleanup);

  describe("given a pending evaluator on a row the target has produced output for", () => {
    /** @scenario Pending evaluator chip shows "Run" when target output exists */
    it("offers Run", async () => {
      const menu = await openMenu({ hasTargetOutput: true, hasAnyTargetOutputs: true });

      expect(isOffered(item(menu, "Run"))).toBe(true);
      expect(item(menu, "Rerun")).toBeNull();
    });

    /** @scenario Evaluator chip menu shows "Run on all rows" when target outputs exist */
    it("offers Run on all rows", async () => {
      const menu = await openMenu({ hasTargetOutput: true, hasAnyTargetOutputs: true });

      expect(isOffered(item(menu, "Run on all rows"))).toBe(true);
    });
  });

  describe("given a pending evaluator on a row with no target output", () => {
    /** @scenario Pending evaluator chip hides "Run" when no target output exists */
    it("does not offer Run", async () => {
      const menu = await openMenu({ hasTargetOutput: false, hasAnyTargetOutputs: false });

      expect(isOffered(item(menu, "Run"))).toBe(false);
    });
  });

  describe("given an evaluator that already has a result", () => {
    /** @scenario Completed evaluator chip shows "Rerun" instead of "Run" */
    it("offers Rerun and not Run", async () => {
      const menu = await openMenu({
        result: { passed: true },
        hasTargetOutput: true,
        hasAnyTargetOutputs: true,
      });

      expect(isOffered(item(menu, "Rerun"))).toBe(true);
      expect(item(menu, "Run on all rows")).not.toBeNull();
      // The only item starting with "Run " here is "Run on all rows".
      expect(
        Array.from(menu.querySelectorAll('[role="menuitem"]')).some(
          (element) => element.textContent?.trim() === "Run",
        ),
      ).toBe(false);
    });
  });

  describe("given an evaluator that is running", () => {
    /** @scenario Running evaluator chip hides both "Run" and "Rerun" */
    /** @scenario '"Run on all rows" is hidden while evaluator is running' */
    it("offers neither Run, Rerun, nor Run on all rows", async () => {
      const menu = await openMenu({
        isRunning: true,
        hasTargetOutput: true,
        hasAnyTargetOutputs: true,
      });

      for (const label of ["Run", "Rerun", "Run on all rows"]) {
        expect(item(menu, label)).toBeNull();
      }
    });
  });
});
