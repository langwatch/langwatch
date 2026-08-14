/**
 * @vitest-environment jsdom
 *
 * The chart's contract with the Vega runtime, and its behaviour when there is
 * no chart to show.
 *
 * `vega-embed` is replaced at the module boundary. What is asserted here is
 * ours — the options a governed chart is embedded with, when a view is rebuilt
 * versus fed, and that every failure has a state of its own. What Vega draws
 * from those options is Vega's, and is proven in a real browser instead.
 *
 * Spec: specs/analytics/governed-sql-workbench.feature
 */

import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { render, screen, waitFor } from "@testing-library/react";
import type { ReactElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { GovernedVegaLiteChart } from "../components/GovernedVegaLiteChart";
import { GovernedVegaLoadBlockedError } from "../visualization/noNetworkVegaLoader";
import type {
  GovernedDataset,
  GovernedDatasetColumn,
} from "../visualization/visualization.types";

import inlineDataValues from "./fixtures/adversarial/inline-data-values.json";
import schemaInvalidEncodingType from "./fixtures/invalid/schema-invalid-encoding-type.json";
import unknownDataset from "./fixtures/invalid/unknown-dataset.json";
import unknownField from "./fixtures/invalid/unknown-field.json";
import unknownSchemaVersion from "./fixtures/invalid/unknown-schema-version.json";
import barOverQueryResult from "./fixtures/valid/bar-over-query-result.json";

const vega = vi.hoisted(() => {
  interface EmbedCall {
    element: unknown;
    spec: Record<string, unknown>;
    options: Record<string, unknown>;
  }

  const state = {
    calls: [] as EmbedCall[],
    data: [] as { name: string; rows: unknown[] }[],
    runs: 0,
    resizes: 0,
    finalized: 0,
    /** Set to make the next embed reject, as a compile or runtime failure. */
    failWith: null as unknown,
  };

  const view = {
    data: (name: string, rows: unknown[]) => {
      state.data.push({ name, rows });
      return view;
    },
    runAsync: () => {
      state.runs += 1;
      return Promise.resolve(view);
    },
    resize: () => {
      state.resizes += 1;
      return view;
    },
  };

  const embed = (
    element: unknown,
    spec: Record<string, unknown>,
    options: Record<string, unknown>,
  ) => {
    state.calls.push({ element, spec, options });
    if (state.failWith !== null) return Promise.reject(state.failWith);
    return Promise.resolve({
      view,
      spec,
      vgSpec: {},
      embedOptions: options,
      finalize: () => {
        state.finalized += 1;
      },
    });
  };

  return { state, embed, view };
});

vi.mock("vega-embed", () => ({ default: vega.embed }));

/** Set to make the next spec build throw, before `embed` is ever reached. */
const build = vi.hoisted(() => ({ throwWith: null as unknown }));

vi.mock("../visualization/buildGovernedVegaSpec", async (importOriginal) => {
  const original =
    await importOriginal<
      typeof import("../visualization/buildGovernedVegaSpec")
    >();
  return {
    ...original,
    buildGovernedVegaSpec: (
      ...args: Parameters<typeof original.buildGovernedVegaSpec>
    ) => {
      if (build.throwWith !== null) throw build.throwWith;
      return original.buildGovernedVegaSpec(...args);
    },
  };
});

const colorModeHarness = vi.hoisted(() => ({
  mode: "light" as "light" | "dark",
}));

vi.mock("~/components/ui/color-mode", async (importOriginal) => {
  const original =
    await importOriginal<typeof import("~/components/ui/color-mode")>();
  return {
    ...original,
    useColorMode: () => ({
      colorMode: colorModeHarness.mode,
      setColorMode: () => undefined,
      toggleColorMode: () => undefined,
    }),
  };
});

const COLUMNS: readonly GovernedDatasetColumn[] = [
  { name: "model", type: "String" },
  { name: "total", type: "UInt64" },
  { name: "latency", type: "Float64" },
  { name: "bucket", type: "DateTime" },
  { name: "series", type: "String" },
];

const ROWS: GovernedDataset = [
  { model: "gpt-5-mini", total: 3, latency: 12.5 },
  { model: "claude", total: 5, latency: 30 },
];

const withChakra = (element: ReactElement) =>
  render(<ChakraProvider value={defaultSystem}>{element}</ChakraProvider>);

const chart = ({
  spec = barOverQueryResult as unknown,
  rows = ROWS,
  columns = COLUMNS,
  ariaLabel,
}: {
  spec?: unknown;
  rows?: GovernedDataset;
  columns?: readonly GovernedDatasetColumn[];
  ariaLabel?: string;
} = {}) => (
  <GovernedVegaLiteChart
    spec={spec}
    datasets={{ query_result: rows }}
    columnsByDataset={{ query_result: columns }}
    {...(ariaLabel === undefined ? {} : { ariaLabel })}
  />
);

const failureCode = () =>
  screen
    .getByTestId("governed-chart-failure")
    .getAttribute("data-failure-code");

beforeEach(() => {
  vega.state.calls = [];
  vega.state.data = [];
  vega.state.runs = 0;
  vega.state.resizes = 0;
  vega.state.finalized = 0;
  vega.state.failWith = null;
  build.throwWith = null;
  colorModeHarness.mode = "light";
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("the governed Vega-Lite chart", () => {
  describe("given a valid specification over the query result", () => {
    describe("when it renders", () => {
      /** @scenario "No embed actions are exposed" */
      /** @scenario "A repository-owned loader refuses all network and file loading" */
      it("embeds with no actions, an interpreter, and the repository's own loader", async () => {
        withChakra(chart());

        await waitFor(() => expect(vega.state.calls).toHaveLength(1));
        const options = vega.state.calls[0]!.options;

        // No source, compiled-spec, export or open-in-editor menu.
        expect(options.actions).toBe(false);
        // Vega interprets expressions instead of compiling them with
        // `new Function`, which a policy without unsafe-eval refuses.
        expect(options.ast).toBe(true);
        expect(options.renderer).toBe("svg");

        const loader = options.loader as Record<string, unknown>;
        expect(typeof loader.load).toBe("function");
        await expect(
          (loader.load as (uri: string) => Promise<unknown>)(
            "https://example.test/data.json",
          ),
        ).rejects.toBeInstanceOf(GovernedVegaLoadBlockedError);
      });

      // The half of the scenario that lives outside a browser: the chart is
      // given a container-sized specification and tooltips are on. Whether the
      // pixels reflow and the tooltip appears is proven in a real browser.
      /** @scenario "A time-bucketed multi-series result renders responsively with tooltips" */
      it("asks for a container-sized chart with tooltips enabled", async () => {
        withChakra(chart());

        await waitFor(() => expect(vega.state.calls).toHaveLength(1));
        const { spec, options } = vega.state.calls[0]!;

        expect(spec.width).toBe("container");
        expect(options.tooltip).toEqual({ theme: "light" });
      });

      it("hands Vega the rows by name rather than letting the specification carry them", async () => {
        withChakra(chart());

        await waitFor(() => expect(vega.state.calls).toHaveLength(1));
        expect(vega.state.calls[0]!.spec.datasets).toEqual({
          query_result: [...ROWS],
        });
      });

      /** @scenario "The chart is accessible and does not trap focus" */
      it("carries an accessible name and description, and takes no focus", async () => {
        withChakra(chart({ ariaLabel: "Chart of the result of run 4" }));

        const view = await screen.findByRole("img", {
          name: "Chart of the result of run 4",
        });
        const describedBy = view.getAttribute("aria-describedby");
        expect(describedBy).not.toBeNull();
        expect(document.getElementById(describedBy!)?.textContent).toContain(
          "table",
        );
        expect(view.getAttribute("tabindex")).toBeNull();
      });
    });

    describe("when only the rows change", () => {
      /** @scenario "A data-only Reload updates the chart through the live view" */
      it("feeds the running view instead of building a new one", async () => {
        const first = { query_result: ROWS };
        const { rerender } = withChakra(
          <GovernedVegaLiteChart
            spec={barOverQueryResult}
            datasets={first}
            columnsByDataset={{ query_result: COLUMNS }}
          />,
        );
        await waitFor(() => expect(vega.state.calls).toHaveLength(1));

        const reloaded: GovernedDataset = [{ model: "gpt-5-mini", total: 9 }];
        rerender(
          <ChakraProvider value={defaultSystem}>
            <GovernedVegaLiteChart
              spec={barOverQueryResult}
              datasets={{ query_result: reloaded }}
              columnsByDataset={{ query_result: COLUMNS }}
            />
          </ChakraProvider>,
        );

        await waitFor(() => expect(vega.state.data).toHaveLength(1));
        expect(vega.state.data[0]).toEqual({
          name: "query_result",
          rows: [...reloaded],
        });
        expect(vega.state.runs).toBeGreaterThan(0);
        // The working view was never torn down and rebuilt.
        expect(vega.state.calls).toHaveLength(1);
        expect(vega.state.finalized).toBe(0);
      });
    });

    describe("when the specification, the colour mode, or the container changes", () => {
      /** @scenario "Spec, size, and color-mode changes update the chart and unmount finalizes it" */
      it("rebuilds the view for a new specification and finalizes the old one", async () => {
        const { rerender } = withChakra(chart());
        await waitFor(() => expect(vega.state.calls).toHaveLength(1));

        rerender(
          <ChakraProvider value={defaultSystem}>
            {chart({
              spec: { ...(barOverQueryResult as object), height: 300 },
            })}
          </ChakraProvider>,
        );

        await waitFor(() => expect(vega.state.calls).toHaveLength(2));
        expect(vega.state.finalized).toBe(1);
      });

      /** @scenario "The chart follows LangWatch theming in light and dark modes" */
      it("rebuilds with a dark configuration when the colour mode flips", async () => {
        const { rerender } = withChakra(chart());
        await waitFor(() => expect(vega.state.calls).toHaveLength(1));
        const light = vega.state.calls[0]!.options.config as Record<
          string,
          any
        >;

        colorModeHarness.mode = "dark";
        rerender(
          <ChakraProvider value={defaultSystem}>{chart()}</ChakraProvider>,
        );

        await waitFor(() => expect(vega.state.calls).toHaveLength(2));
        const dark = vega.state.calls[1]!.options.config as Record<string, any>;

        expect(dark.axis.labelColor).not.toBe(light.axis.labelColor);
        expect(dark.range.category).not.toEqual(light.range.category);
        expect(light.background).toBe("transparent");
        expect(vega.state.calls[1]!.options.tooltip).toEqual({ theme: "dark" });
      });

      /** @scenario "Spec, size, and color-mode changes update the chart and unmount finalizes it" */
      it("resizes the running view when its container changes size", async () => {
        const observers: (() => void)[] = [];
        vi.stubGlobal(
          "ResizeObserver",
          class {
            constructor(callback: () => void) {
              observers.push(callback);
            }
            observe() {}
            disconnect() {}
          },
        );

        withChakra(chart());
        await waitFor(() => expect(observers.length).toBeGreaterThan(0));

        observers[0]!();
        expect(vega.state.resizes).toBe(1);
      });

      /** @scenario "Spec, size, and color-mode changes update the chart and unmount finalizes it" */
      it("finalizes the view when the chart unmounts", async () => {
        const { unmount } = withChakra(chart());
        await waitFor(() => expect(vega.state.calls).toHaveLength(1));

        unmount();

        expect(vega.state.finalized).toBe(1);
      });
    });
  });

  describe("given values a chart cannot place on an axis", () => {
    /** @scenario "Values Vega cannot represent faithfully produce a warning, not a zero" */
    it("draws the chart and warns rather than turning them into zero", async () => {
      withChakra(
        chart({
          rows: [
            { model: "a", total: 0 },
            { model: "b", total: Number.NaN },
          ],
        }),
      );

      await waitFor(() => expect(vega.state.calls).toHaveLength(1));
      const warnings = await screen.findByTestId("governed-chart-warnings");

      expect(warnings.textContent).toContain("total");
      expect(
        warnings
          .querySelector("[data-warning-code]")
          ?.getAttribute("data-warning-code"),
      ).toBe("unrepresentable-value");
      // Nothing was coerced on the way in: the zero is still a zero and the
      // value that cannot be placed is still itself, warned about rather than
      // rewritten into one that would draw as a real measurement.
      expect(vega.state.calls[0]!.spec.datasets).toEqual({
        query_result: [
          { model: "a", total: 0 },
          { model: "b", total: Number.NaN },
        ],
      });
    });
  });

  describe("given a chart that cannot be drawn", () => {
    /** @scenario "Chart failures are distinct intentional states, never a blank chart" */
    it("renders a distinct, named state for each cause and never a blank chart", async () => {
      const cases: { name: string; element: ReactElement; code: string }[] = [
        {
          name: "not an object",
          element: chart({ spec: "https://example.test/spec.json" }),
          code: "spec-not-object",
        },
        {
          name: "wrong version",
          element: chart({ spec: unknownSchemaVersion }),
          code: "unsupported-schema-version",
        },
        {
          name: "schema failure",
          element: chart({ spec: schemaInvalidEncodingType }),
          code: "schema-failure",
        },
        {
          name: "refused by policy",
          element: chart({ spec: inlineDataValues }),
          code: "policy-rejection",
        },
        {
          name: "unknown dataset",
          element: chart({ spec: unknownDataset }),
          code: "unknown-dataset",
        },
        {
          name: "unknown column",
          element: chart({ spec: unknownField }),
          code: "unknown-field",
        },
        {
          name: "nothing to draw",
          element: chart({
            rows: [{ model: null, total: null }],
          }),
          code: "empty-encoding",
        },
      ];

      const seen = new Set<string>();
      for (const { name, element, code } of cases) {
        const { unmount } = withChakra(element);

        const state = await screen.findByTestId("governed-chart-failure");
        expect(failureCode(), name).toBe(code);
        expect(state.textContent?.length ?? 0, name).toBeGreaterThan(20);
        expect(screen.queryByRole("img"), name).toBeNull();
        seen.add(state.textContent ?? "");

        unmount();
      }

      // Distinct states, not one panel wearing seven codes.
      expect(seen.size).toBe(cases.length);
      expect(vega.state.calls).toHaveLength(0);
    });

    /** @scenario "Chart failures are distinct intentional states, never a blank chart" */
    it("names a failure from inside the chart runtime", async () => {
      vega.state.failWith = new Error("Unrecognized signal name: bogus");
      withChakra(chart());

      await screen.findByTestId("governed-chart-failure");
      expect(failureCode()).toBe("render-failure");
      expect(
        screen.getByTestId("governed-chart-failure").textContent,
      ).toContain("Unrecognized signal name");
    });

    /** @scenario "Chart failures are distinct intentional states, never a blank chart" */
    it("names a failure raised while the specification is being built", async () => {
      // A build throw is synchronous, so it lands before `embed` has a
      // rejection handler. Unguarded it escapes the effect and the panel sits
      // on "embedding" forever — a blank chart, which is the one outcome this
      // module promises never to produce.
      build.throwWith = new Error("Spec build gave out");
      withChakra(chart());

      await screen.findByTestId("governed-chart-failure");
      expect(failureCode()).toBe("render-failure");
      expect(
        screen.getByTestId("governed-chart-failure").textContent,
      ).toContain("Spec build gave out");
      // The failure has to come instead of the embed, not alongside it.
      expect(vega.state.calls).toHaveLength(0);
    });

    /** @scenario "Chart failures are distinct intentional states, never a blank chart" */
    it("draws again once the specification that failed is changed", async () => {
      vega.state.failWith = new Error("Unrecognized signal name: bogus");
      const { rerender } = withChakra(chart());
      await screen.findByTestId("governed-chart-failure");

      vega.state.failWith = null;
      rerender(
        <ChakraProvider value={defaultSystem}>
          {chart({ spec: { ...(barOverQueryResult as object), height: 240 } })}
        </ChakraProvider>,
      );

      // The refusal outlives the render that clears it, so the mount point has
      // to survive it: without that, this is a chart that never comes back.
      await waitFor(() =>
        expect(screen.queryByTestId("governed-chart-failure")).toBeNull(),
      );
      expect(vega.state.calls).toHaveLength(2);
      await screen.findByRole("img");
    });

    /** @scenario "A repository-owned loader refuses all network and file loading" */
    it("names a refused resource load without repeating its credentials", async () => {
      vega.state.failWith = new GovernedVegaLoadBlockedError({
        reference: "https://example.test/rows.json?token=secret-value",
        method: "http",
      });
      withChakra(chart());

      await screen.findByTestId("governed-chart-failure");
      expect(failureCode()).toBe("loader-blocked");
      expect(
        screen.getByTestId("governed-chart-failure").textContent,
      ).not.toContain("secret-value");
    });

    /** @scenario "A chart over too much data refuses clearly and leaves the table available" */
    it("refuses a result past the row ceiling, naming the limit it crossed", async () => {
      const tooMany: GovernedDataset = Array.from(
        { length: 10_001 },
        (_, index) => ({ model: `m${index}`, total: index }),
      );

      withChakra(chart({ rows: tooMany }));

      await screen.findByTestId("governed-chart-failure");
      const panel = screen.getByTestId("governed-chart-failure");
      expect(failureCode()).toBe("complexity-refusal");
      expect(panel.textContent).toContain("10000");
      expect(panel.textContent).toContain("10001");
      // Nothing was sampled to make it fit: the runtime was never reached.
      expect(vega.state.calls).toHaveLength(0);
    });
  });
});
