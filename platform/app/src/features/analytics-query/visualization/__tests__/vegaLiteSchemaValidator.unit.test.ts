/**
 * The generated Vega-Lite schema validator, against the schema it claims to be.
 *
 * Two independent guards, because either one alone can be satisfied by a stale
 * artefact:
 *
 *   1. DRIFT — regenerating from the installed schema must reproduce the
 *      committed module byte for byte. Ajv's standalone output is deterministic
 *      across processes, so anything else means the schema, the Ajv version, or
 *      the generator moved and the committed file did not.
 *   2. PARITY — for every fixture in the corpus the generated validator must
 *      reach the same verdict, with the same errors, as a validator Ajv compiles
 *      from the official schema right here. That is the check that survives a
 *      generator whose *output shape* changes but whose meaning must not.
 *
 * Node environment on purpose: the runtime compile this test performs is the
 * very `new Function` call the generated module exists to keep out of a browser,
 * and node has no Content-Security-Policy to violate.
 */
import Ajv, { type ErrorObject } from "ajv";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  GENERATED_VALIDATOR_PATH,
  generateVegaLiteValidatorSource,
  readBundledVegaLiteSchema,
  VEGA_LITE_AJV_OPTIONS,
} from "../../../../../scripts/generate-vega-lite-validator";
import { getVegaLiteSchemaValidator } from "../vegaLiteSchema";

import { ADVERSARIAL_VEGA_FIXTURES } from "../../__tests__/fixtures/adversarial";
import { INVALID_VEGA_FIXTURES } from "../../__tests__/fixtures/invalid";
import { VALID_VEGA_FIXTURES } from "../../__tests__/fixtures/valid";

/** `…/visualization/__tests__` → `platform/app/` */
const APP_ROOT = fileURLToPath(new URL("../../../../../", import.meta.url));

const CORPUS: readonly { name: string; spec: unknown }[] = [
  ...VALID_VEGA_FIXTURES.map(({ name, spec }) => ({
    name: `valid/${name}`,
    spec,
  })),
  ...INVALID_VEGA_FIXTURES.map(({ name, spec }) => ({
    name: `invalid/${name}`,
    spec,
  })),
  ...ADVERSARIAL_VEGA_FIXTURES.map(({ name, spec }) => ({
    name: `adversarial/${name}`,
    spec,
  })),
];

/** The projection Ajv guarantees at `verbose: false`, and all a refusal reads. */
const readable = (errors: readonly ErrorObject[] | null | undefined) =>
  (errors ?? []).map((error) => ({
    instancePath: error.instancePath,
    schemaPath: error.schemaPath,
    keyword: error.keyword,
    params: error.params,
    message: error.message,
  }));

/** The property the refusal message is built from: the most specific paths. */
const deepestPaths = (errors: readonly ErrorObject[] | null | undefined) => {
  const paths = (errors ?? []).map((error) => error.instancePath);
  if (paths.length === 0) return [];
  const deepest = Math.max(...paths.map((path) => path.length));
  return [...new Set(paths.filter((path) => path.length === deepest))].sort();
};

describe("the generated Vega-Lite v6 schema validator", () => {
  describe("given the schema bundled with the installed vega-lite", () => {
    describe("when the generator is re-run", () => {
      /** @scenario "A spec validates against the bundled official Vega-Lite v6 schema" */
      it("reproduces the committed module byte for byte", () => {
        const regenerated = generateVegaLiteValidatorSource(
          readBundledVegaLiteSchema(),
        );
        const committed = readFileSync(
          `${APP_ROOT}${GENERATED_VALIDATOR_PATH}`,
          "utf8",
        );

        expect(
          regenerated === committed,
          "the committed validator has drifted from the installed schema — run `pnpm generate:vega-validator`",
        ).toBe(true);
      });

      it("carries the do-not-edit header naming the script that writes it", () => {
        const committed = readFileSync(
          `${APP_ROOT}${GENERATED_VALIDATOR_PATH}`,
          "utf8",
        );
        expect(committed).toContain("GENERATED FILE — DO NOT EDIT");
        expect(committed).toContain("pnpm generate:vega-validator");
        // The point of the whole exercise: no `new Function` in the browser.
        expect(committed).not.toContain("new Function");
      });
    });

    describe("when a validator is compiled from that schema at runtime", () => {
      /** @scenario "A spec validates against the bundled official Vega-Lite v6 schema" */
      it("agrees with the generated validator across the whole fixture corpus", () => {
        const ajv = new Ajv({ ...VEGA_LITE_AJV_OPTIONS });
        const runtime = ajv.compile(readBundledVegaLiteSchema());
        const generated = getVegaLiteSchemaValidator();

        expect(CORPUS.length).toBeGreaterThan(30);

        for (const { name, spec } of CORPUS) {
          const runtimeVerdict = runtime(spec);
          const generatedVerdict = generated(spec);

          expect(generatedVerdict, `${name}: verdict`).toBe(runtimeVerdict);
          expect(readable(generated.errors), `${name}: errors`).toEqual(
            readable(runtime.errors),
          );
          expect(deepestPaths(generated.errors), `${name}: deepest`).toEqual(
            deepestPaths(runtime.errors),
          );
        }
      });

      it("finds at least one fixture the schema itself refuses, so agreement is not vacuous", () => {
        const generated = getVegaLiteSchemaValidator();
        const refused = CORPUS.filter(({ spec }) => !generated(spec));

        expect(refused.map(({ name }) => name)).toContain(
          "invalid/schema-invalid-encoding-type",
        );
      });
    });
  });
});
