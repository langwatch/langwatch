/**
 * What the chart runtime is actually handed.
 *
 * The load-bearing claim is that data reaches Vega only by injection: whatever
 * a specification says about `datasets`, what arrives is built here from the
 * registry. The adversarial corpus proves the policy refuses a caller-supplied
 * `datasets` first; this proves the second lock holds even if the first is
 * removed, which is the one that matters when someone loosens the policy.
 *
 * Node environment on purpose — see `validateVegaLiteSpec.unit.test.ts`.
 */
import { describe, expect, it } from "vitest";

import callerSuppliedDatasets from "../../__tests__/fixtures/adversarial/caller-supplied-datasets.json";
import usermetaEmbedOptions from "../../__tests__/fixtures/adversarial/usermeta-embed-options.json";
import barOverQueryResult from "../../__tests__/fixtures/valid/bar-over-query-result.json";
import lookupBetweenRegisteredDatasets from "../../__tests__/fixtures/valid/lookup-between-registered-datasets.json";
import {
  buildLangWatchQLVegaSpec,
  mergeConfig,
  referencedDatasetNames,
} from "../buildLangWatchQLVegaSpec";
import type { LangWatchQLDataset } from "../visualization.types";

const QUERY_ROWS: LangWatchQLDataset = [
  { model: "gpt-5-mini", total: 3 },
  { model: "claude", total: 5 },
];
const CATALOG_ROWS: LangWatchQLDataset = [{ model: "gpt-5-mini", vendor: "OpenAI" }];

const PINNED = {
  background: "transparent",
  font: "Inter, sans-serif",
  axis: { titleFont: "Inter, sans-serif" },
};

const build = (
  spec: unknown,
  datasets: Readonly<Record<string, LangWatchQLDataset>> = {
    query_result: QUERY_ROWS,
  },
) => buildLangWatchQLVegaSpec({ spec, datasets, pinnedConfig: PINNED });

describe("building the specification the chart runtime is given", () => {
  describe("given a validated specification and the registered datasets", () => {
    describe("when the specification is built", () => {
      /** @scenario "Caller-supplied datasets and inline values are rejected" */
      it("injects the registered rows and discards any datasets the caller wrote", () => {
        const { spec, datasetNames } = build(callerSuppliedDatasets);
        const datasets = spec.datasets as Record<string, unknown[]>;

        // The fixture carries its own `datasets` block. Nothing of it survives.
        const callerBlock = (
          callerSuppliedDatasets as { datasets?: Record<string, unknown> }
        ).datasets;
        const smuggled = Object.keys(callerBlock ?? {});
        expect(smuggled.length).toBeGreaterThan(0);
        expect(Object.keys(datasets)).toEqual(datasetNames);
        for (const name of smuggled) {
          expect(Object.keys(datasets)).not.toContain(name);
        }
        for (const name of Object.keys(datasets)) {
          expect(datasets[name]).toEqual([...QUERY_ROWS]);
        }
      });

      /** @scenario "Spec-controlled runtime options are rejected" */
      it("hands the runtime no usermeta, which is where a spec would replace the loader", () => {
        // vega-embed reads `usermeta.embedOptions` off the specification and
        // lets a `loader` found there stand in for the one it was passed — the
        // deny-everything loader. The policy refuses the property; this is the
        // second lock, and the one that holds if the first is ever loosened.
        const smuggled = (
          usermetaEmbedOptions as { usermeta?: { embedOptions?: object } }
        ).usermeta;
        expect(smuggled?.embedOptions).toBeDefined();

        const { spec } = build(usermetaEmbedOptions);
        expect(spec.usermeta).toBeUndefined();
        expect(JSON.stringify(spec)).not.toContain("embedOptions");
      });

      /** @scenario "The renderer contract accepts multiple registered named datasets" */
      it("injects every registered dataset the specification reads, by name", () => {
        const { spec, datasetNames } = build(lookupBetweenRegisteredDatasets, {
          query_result: QUERY_ROWS,
          model_catalog: CATALOG_ROWS,
        });

        expect([...datasetNames].sort()).toEqual(["model_catalog", "query_result"]);
        expect(spec.datasets).toEqual({
          query_result: [...QUERY_ROWS],
          model_catalog: [...CATALOG_ROWS],
        });
      });

      it("registers only the datasets the specification actually reads", () => {
        const { spec, datasetNames } = build(barOverQueryResult, {
          query_result: QUERY_ROWS,
          model_catalog: CATALOG_ROWS,
        });

        expect(datasetNames).toEqual(["query_result"]);
        expect(Object.keys(spec.datasets as object)).toEqual(["query_result"]);
      });

      it("never mutates the specification it was given", () => {
        const original = JSON.stringify(barOverQueryResult);
        const { spec } = build(barOverQueryResult);

        expect(JSON.stringify(barOverQueryResult)).toBe(original);
        expect(spec).not.toBe(barOverQueryResult);
      });

      /** @scenario "The chart follows LangWatch theming in light and dark modes" */
      it("lets the member restyle, and not change the background or the font", () => {
        const { spec } = build({
          ...(barOverQueryResult as Record<string, unknown>),
          background: "#ff0000",
          config: {
            background: "#ff0000",
            font: "Comic Sans",
            axis: { labelColor: "#00ff00", titleFont: "Comic Sans" },
          },
        });
        const config = spec.config as Record<string, any>;

        expect(spec.background).toBe("transparent");
        expect(config.background).toBe("transparent");
        expect(config.font).toBe("Inter, sans-serif");
        expect(config.axis.titleFont).toBe("Inter, sans-serif");
        // The style choice the pinned set says nothing about is kept.
        expect(config.axis.labelColor).toBe("#00ff00");
      });

      it("sizes a single view against its container, and leaves a stated width alone", () => {
        expect(build(barOverQueryResult).spec.width).toBe("container");
        expect(build({ ...(barOverQueryResult as object), width: 420 }).spec.width).toBe(
          420,
        );
      });

      it("leaves a composition alone, which cannot be container-sized", () => {
        const { spec } = build({
          data: { name: "query_result" },
          repeat: ["total"],
          spec: { mark: "bar" },
        });

        expect(spec.width).toBeUndefined();
      });
    });
  });

  describe("given a name that is not registered", () => {
    it("is not reported as a dataset to update", () => {
      expect(
        referencedDatasetNames({
          spec: { data: { name: "somewhere_else" }, mark: "bar" },
          registered: ["query_result"],
        }),
      ).toEqual([]);
    });
  });

  describe("given two configurations to merge", () => {
    it("merges plain objects key by key and lets the override win", () => {
      expect(
        mergeConfig({
          base: { axis: { labelColor: "a", gridColor: "b" }, font: "x" },
          override: { axis: { labelColor: "c" }, background: "t" },
        }),
      ).toEqual({
        axis: { labelColor: "c", gridColor: "b" },
        font: "x",
        background: "t",
      });
    });
  });
});
