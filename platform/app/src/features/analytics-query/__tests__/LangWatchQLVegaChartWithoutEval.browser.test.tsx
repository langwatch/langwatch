/**
 * The LangWatchQL chart drawn on a page where nothing may be evaluated from a
 * string.
 *
 * A Content-Security-Policy without `unsafe-eval` makes `eval` and the
 * `Function` constructor throw. The application's production policy still
 * carries `unsafe-eval` for unrelated scripts and dev mode serves no policy
 * header at all, so "renders under the real policy" would be vacuously green.
 * This hardens the page instead — `eval` and `Function` are replaced with
 * throwing stubs for the duration of the render, which is strictly stronger
 * than the deployed policy — and then proves the hardening is a real detector
 * by embedding the very same specification through the very same runtime with
 * `ast` turned off, where it fails.
 *
 * The hardening is installed only after every module has been imported: the
 * test harness itself evaluates modules from source text, and hardening before
 * that would fail the harness rather than the chart.
 *
 * Spec: packages/features/analytics/specs/analytics-lwql-workbench.feature
 */

import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { page } from "vitest/browser";
import "@testing-library/jest-dom/vitest";

vi.mock("~/utils/compat/next-dynamic", () => {
  function StubSpecEditor(props: {
    value?: string;
    onChange?: (value: string | undefined) => void;
  }) {
    return (
      <textarea
        data-testid="spec-editor-input"
        aria-label="Chart specification"
        value={props.value ?? ""}
        onChange={(event) => props.onChange?.(event.target.value)}
      />
    );
  }

  return { __esModule: true, default: () => StubSpecEditor };
});

import embed from "vega-embed";

import { LangWatchQLChartMode } from "../components/LangWatchQLChartMode";
import {
  lwqlVegaEmbedOptions,
  type LangWatchQLDatasetColumn,
} from "@langwatch/analytics-web/chart";
import { buildLangWatchQLVegaSpec } from "@langwatch/analytics-web/visualization";

const COLUMNS: readonly LangWatchQLDatasetColumn[] = [
  { name: "evaluator_name", type: "String" },
  { name: "evaluations", type: "UInt64" },
];

const RESULT = {
  columns: COLUMNS,
  rows: [
    { evaluator_name: "exact match", evaluations: 12 },
    { evaluator_name: "factual correctness", evaluations: 7 },
    { evaluator_name: "answer relevancy", evaluations: 21 },
  ],
};

const BAR_SPECIFICATION = {
  $schema: "https://vega.github.io/schema/vega-lite/v6.json",
  data: { name: "query_result" },
  mark: "bar",
  encoding: {
    x: { field: "evaluator_name", type: "nominal" },
    y: { field: "evaluations", type: "quantitative" },
  },
};

/** What a policy without `unsafe-eval` does to both string evaluators. */
interface Hardening {
  /** Restores the real `eval` and `Function`. */
  readonly release: () => void;
  /** Whether both evaluators actually refused while hardened. */
  readonly isRefusing: () => boolean;
}

function forbidStringEvaluation(): Hardening {
  const realEval = globalThis.eval;
  const realFunction = globalThis.Function;

  function refusesStringEvaluation(): never {
    throw new EvalError(
      "Refused to evaluate a string: the page's Content-Security-Policy forbids unsafe-eval.",
    );
  }

  // A refused `Function` is still the constructor object every function's
  // prototype chain runs through — a policy stops the *call*, it does not
  // remove `Function.prototype`. Keeping the real one is both more faithful
  // and load-bearing: React's development-mode render logging reads it, and a
  // stub without it fails the harness instead of the chart.
  const refusingFunction = function HardenedFunction(): never {
    return refusesStringEvaluation();
  };
  refusingFunction.prototype = realFunction.prototype;

  globalThis.eval = refusesStringEvaluation as unknown as typeof globalThis.eval;
  globalThis.Function = refusingFunction as unknown as FunctionConstructor;

  return {
    release: () => {
      globalThis.eval = realEval;
      globalThis.Function = realFunction;
    },
    isRefusing: () => {
      let evalRefused = false;
      let functionRefused = false;
      try {
        globalThis.eval("1");
      } catch {
        evalRefused = true;
      }
      try {
        globalThis.Function("return 1");
      } catch {
        functionRefused = true;
      }
      return evalRefused && functionRefused;
    },
  };
}

function bars(container: ParentNode = document): Element[] {
  return Array.from(
    container.querySelectorAll(
      '[data-testid="lwql-vega-chart-view"] svg g.mark-rect path',
    ),
  );
}

async function poll(check: () => boolean, timeoutMs = 15_000): Promise<boolean> {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (check()) return true;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  return check();
}

beforeEach(async () => {
  await page.viewport(1280, 900);
});

afterEach(() => cleanup());

describe("the LangWatchQL chart on a page that forbids string evaluation", () => {
  describe("given the workbench served under a policy without unsafe-eval", () => {
    describe("when a valid specification renders as a chart", () => {
      /** @scenario "The chart renders under a CSP that forbids eval" */
      it("draws through Vega's expression interpreter, while the same specification with the interpreter disabled is refused", async () => {
        // The control differs from the shipped path by exactly one option, and
        // this is the shipped value of it.
        expect(lwqlVegaEmbedOptions({ themeConfig: {}, colorMode: "light" }).ast).toBe(
          true,
        );

        // The specification Vega is actually handed, built the way the chart
        // builds it: the member's specification names the dataset, the rows are
        // injected here.
        const handedToVega = buildLangWatchQLVegaSpec({
          spec: BAR_SPECIFICATION,
          datasets: { query_result: RESULT.rows },
          pinnedConfig: {},
        });

        const control = document.createElement("div");
        document.body.appendChild(control);

        const hardening = forbidStringEvaluation();
        let refusingAtRenderTime = false;
        let drawn = false;
        let refusingAfterRender = false;
        let controlFailure: unknown = null;

        try {
          refusingAtRenderTime = hardening.isRefusing();

          render(
            <ChakraProvider value={defaultSystem}>
              {/* Nothing here edits the specification, so the owner's half of
                  that state is a starter this test never changes. */}
              <LangWatchQLChartMode
                result={RESULT}
                editedSpecText={null}
                onEditedSpecTextChange={() => undefined}
              />
            </ChakraProvider>,
          );
          drawn = await poll(() => bars().length === RESULT.rows.length);

          // Same page, same runtime, same specification — with the
          // interpreter turned off, so expressions are compiled from source
          // text instead of walked as an abstract syntax tree.
          try {
            await embed(control, handedToVega.spec as Parameters<typeof embed>[1], {
              ...lwqlVegaEmbedOptions({
                themeConfig: {},
                colorMode: "light",
              }),
              ast: false,
            });
          } catch (error) {
            controlFailure = error;
          }

          // Still refusing at the end, so nothing under test quietly restored
          // the evaluators midway and rendered the easy way.
          refusingAfterRender = hardening.isRefusing();
        } finally {
          hardening.release();
        }

        expect(refusingAtRenderTime).toBe(true);
        expect(refusingAfterRender).toBe(true);

        // Rendering succeeded with no evaluator available at all.
        expect(drawn).toBe(true);
        expect(screen.queryByTestId("lwql-chart-failure")).toBeNull();
        expect(
          document.querySelector('[data-testid="lwql-vega-chart-view"]'),
        ).toHaveAttribute("data-chart-status", "ready");

        // …and the detector is real: the same specification through the same
        // runtime, with the interpreter disabled, is refused by the policy.
        expect(controlFailure).toBeInstanceOf(EvalError);
        expect(String(controlFailure)).toContain("unsafe-eval");
        expect(bars(control)).toHaveLength(0);
      });
    });
  });
});
