/**
 * The entry point: what counts as a specification at all, which schema decides
 * validity, and what the renderer contract is allowed to carry.
 *
 * Node environment on purpose — no jsdom docblock. These modules passing under
 * plain node IS the server-import-safety commitment, not an accident of setup.
 */
import { describe, expect, it, vi } from "vitest";

import {
  GOVERNED_FIXTURE_COLUMNS,
  GOVERNED_FIXTURE_ROW_COUNTS,
} from "../../__tests__/fixtures/governedDatasetRegistry";
import {
  schemaInvalidEncodingType,
  unknownSchemaVersion,
} from "../../__tests__/fixtures/invalid";
import {
  barOverQueryResult,
  lookupBetweenRegisteredDatasets,
} from "../../__tests__/fixtures/valid";
import {
  parseVegaLiteSpecText,
  validateVegaLiteSpec,
} from "../validateVegaLiteSpec";
import { VEGA_LITE_SCHEMA_URL } from "../vegaLiteSchema";
import type {
  GovernedVegaLiteChartProps,
  VegaLiteValidationResult,
  VegaValidationError,
} from "../visualization.types";

const validate = (spec: unknown, rows = GOVERNED_FIXTURE_ROW_COUNTS) =>
  validateVegaLiteSpec({
    spec,
    columnsByDataset: GOVERNED_FIXTURE_COLUMNS,
    rowCountsByDataset: rows,
  });

const rulesOf = (errors: readonly VegaValidationError[]) =>
  errors.map((error) => error.rule);

/** Every refusal as a `[rule, code]` pair, or `[]` when the spec was admitted. */
const refusalsOf = (result: VegaLiteValidationResult): [string, string][] =>
  result.ok ? [] : result.errors.map((error) => [error.rule, error.code]);

const messagesOf = (result: VegaLiteValidationResult): string[] =>
  result.ok ? [] : result.errors.map((error) => error.message);

describe("validateVegaLiteSpec", () => {
  describe("given a candidate specification", () => {
    describe("when it is validated", () => {
      /** @scenario "A spec validates against the bundled official Vega-Lite v6 schema" */
      it("lets the bundled v6 schema decide validity without fetching anything", () => {
        const reachedTheNetwork = vi.fn(() => {
          throw new Error("the validator must not fetch a schema");
        });
        vi.stubGlobal("fetch", reachedTheNetwork);

        try {
          expect(validate(barOverQueryResult).ok).toBe(true);

          const refused = validate(schemaInvalidEncodingType);
          expect(refused.ok).toBe(false);
          if (refused.ok) return;

          expect(rulesOf(refused.errors)).toContain("spec.schema-invalid");
          for (const error of refused.errors) {
            expect(error.code).toBe("schema-failure");
            expect(error.path).toBe("/encoding/x/type");
            expect(error.message.length).toBeGreaterThan(0);
          }
        } finally {
          vi.unstubAllGlobals();
        }

        expect(reachedTheNetwork).not.toHaveBeenCalled();
      });

      it("carries a stable code, a JSON pointer, and a message on every refusal", () => {
        const refused = validate({ data: { name: "nope" }, mark: "bar" });

        expect(refused.ok).toBe(false);
        if (refused.ok) return;
        for (const error of refused.errors) {
          expect(error.code).toBeTruthy();
          expect(error.rule).toBeTruthy();
          expect(error.path.startsWith("/")).toBe(true);
          expect(error.message.length).toBeGreaterThan(0);
        }
      });
    });
  });

  describe("given a value that is not a parsed specification object", () => {
    describe("when it is offered for validation", () => {
      /** @scenario "Only a parsed JSON object of the supported version is accepted" */
      it("refuses URLs, scalars, arrays, and unsupported schema versions without converting them", () => {
        const notSpecs = [
          "https://vega.github.io/vega-lite/examples/bar.vl.json",
          "{}",
          42,
          null,
          [{ mark: "bar" }],
          true,
        ];

        expect(notSpecs.map((value) => refusalsOf(validate(value)))).toEqual(
          notSpecs.map(() => [["spec.not-object", "spec-not-object"]]),
        );

        const wrongVersion = validate(unknownSchemaVersion);
        expect(refusalsOf(wrongVersion)).toEqual([
          ["spec.unsupported-schema-version", "unsupported-schema-version"],
        ]);
        expect(messagesOf(wrongVersion).join(" ")).toContain(
          VEGA_LITE_SCHEMA_URL,
        );

        // Nothing was rewritten to the supported version on the way through.
        expect((unknownSchemaVersion as { $schema: string }).$schema).toBe(
          "https://vega.github.io/schema/vega-lite/v5.json",
        );
      });

      it("reads an absent schema declaration as the supported version", () => {
        const result = validate({
          data: { name: "query_result" },
          mark: "bar",
          encoding: { x: { field: "model", type: "nominal" } },
        });

        expect(result.ok).toBe(true);
      });

      it("reports unparseable specification text as invalid JSON", () => {
        const parsed = parseVegaLiteSpecText('{"mark": "bar",}');

        expect(parsed.ok).toBe(false);
        if (parsed.ok) return;
        expect(parsed.errors[0]?.rule).toBe("spec.not-json");
        expect(parsed.errors[0]?.code).toBe("invalid-json");
        expect(parsed.errors[0]?.path).toBe("/");
      });

      it("passes a parsed object through unchanged", () => {
        const parsed = parseVegaLiteSpecText('{"mark":"bar"}');

        expect(parsed).toEqual({ ok: true, spec: { mark: "bar" } });
      });
    });
  });

  describe("given several registered named datasets and their columns", () => {
    describe("when a spec reads more than one of them", () => {
      /** @scenario "The renderer contract accepts multiple registered named datasets" */
      it("resolves each branch against the dataset that feeds it", () => {
        const layeredOverTwoDatasets = {
          $schema: VEGA_LITE_SCHEMA_URL,
          layer: [
            {
              data: { name: "query_result" },
              mark: "bar",
              encoding: { x: { field: "model", type: "nominal" } },
            },
            {
              data: { name: "model_catalog" },
              mark: "text",
              encoding: { x: { field: "vendor", type: "nominal" } },
            },
          ],
        };

        expect(validate(layeredOverTwoDatasets).ok).toBe(true);
        expect(validate(lookupBetweenRegisteredDatasets).ok).toBe(true);

        // The second branch is resolved against model_catalog, so a
        // query_result column is unknown there rather than quietly accepted.
        const crossedBranches = structuredClone(layeredOverTwoDatasets);
        (
          crossedBranches.layer[1] as { encoding: { x: { field: string } } }
        ).encoding.x.field = "latency";
        const refused = validate(crossedBranches);

        expect(refused.ok).toBe(false);
        if (refused.ok) return;
        expect(rulesOf(refused.errors)).toEqual(["field.unknown"]);
        expect(refused.errors[0]?.meta?.dataset).toBe("model_catalog");
      });

      it("carries a dataset per name and its columns on the renderer contract", () => {
        const props: GovernedVegaLiteChartProps = {
          spec: barOverQueryResult,
          datasets: {
            query_result: [{ model: "a", total: 1 }],
            model_catalog: [{ model: "a", vendor: "OpenAI" }],
          },
          columnsByDataset: GOVERNED_FIXTURE_COLUMNS,
          ariaLabel: "Total by model",
        };

        expect(Object.keys(props.datasets)).toEqual([
          "query_result",
          "model_catalog",
        ]);
        expect(Object.keys(props.columnsByDataset)).toContain("model_catalog");
      });
    });
  });

  describe("given an accepted specification", () => {
    describe("when the result is read", () => {
      it("returns the caller's own object without rewriting it", () => {
        const spec = structuredClone(barOverQueryResult);
        const pristine = structuredClone(spec);

        const result = validate(spec);

        expect(result.ok).toBe(true);
        if (!result.ok) return;
        expect(result.normalized).toBe(spec);
        expect(spec).toEqual(pristine);
      });
    });
  });
});
