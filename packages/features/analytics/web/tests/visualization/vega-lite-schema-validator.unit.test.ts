import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import Ajv, { type ErrorObject } from "ajv";
import { describe, expect, it } from "vitest";

import {
  GENERATED_VALIDATOR_PATH,
  generateVegaLiteValidatorSource,
  readBundledVegaLiteSchema,
  VEGA_LITE_AJV_OPTIONS,
} from "../../scripts/generate-vega-lite-validator";

import { getVegaLiteSchemaValidator } from "../../src/visualization/vega-lite-schema";
import { ADVERSARIAL_VEGA_FIXTURES } from "../fixtures/adversarial";
import { INVALID_VEGA_FIXTURES } from "../fixtures/invalid";
import { VALID_VEGA_FIXTURES } from "../fixtures/valid";

const PACKAGE_ROOT = fileURLToPath(new URL("../../", import.meta.url));

const CORPUS: readonly { name: string; spec: unknown }[] = [
  ...VALID_VEGA_FIXTURES.map(({ name, spec }) => ({ name: `valid/${name}`, spec })),
  ...INVALID_VEGA_FIXTURES.map(({ name, spec }) => ({ name: `invalid/${name}`, spec })),
  ...ADVERSARIAL_VEGA_FIXTURES.map(({ name, spec }) => ({
    name: `adversarial/${name}`,
    spec,
  })),
];

function readable(errors: readonly ErrorObject[] | null | undefined) {
  return (errors ?? []).map((error) => ({
    instancePath: error.instancePath,
    schemaPath: error.schemaPath,
    keyword: error.keyword,
    params: error.params,
    message: error.message,
  }));
}

function deepestPaths(errors: readonly ErrorObject[] | null | undefined) {
  const paths = (errors ?? []).map((error) => error.instancePath);
  if (paths.length === 0) return [];

  const deepest = Math.max(...paths.map((path) => path.length));
  return [...new Set(paths.filter((path) => path.length === deepest))].sort();
}

describe("the generated Vega-Lite v6 schema validator", () => {
  it("reproduces the committed module byte for byte", () => {
    const regenerated = generateVegaLiteValidatorSource(readBundledVegaLiteSchema());
    const committed = readFileSync(`${PACKAGE_ROOT}${GENERATED_VALIDATOR_PATH}`, "utf8");

    expect(
      regenerated === committed,
      "the committed validator has drifted from the installed schema — run `pnpm generate:vega-validator`",
    ).toBe(true);
  });

  it("carries the no-eval generated header", () => {
    const committed = readFileSync(`${PACKAGE_ROOT}${GENERATED_VALIDATOR_PATH}`, "utf8");

    expect(committed).toContain("GENERATED FILE — DO NOT EDIT");
    expect(committed).toContain("pnpm generate:vega-validator");
    expect(committed).not.toContain("new Function");
  });

  it("agrees with a fresh Ajv compile across the full fixture corpus", () => {
    const runtime = new Ajv({ ...VEGA_LITE_AJV_OPTIONS }).compile(readBundledVegaLiteSchema());
    const generated = getVegaLiteSchemaValidator();

    expect(CORPUS.length).toBeGreaterThan(30);

    for (const { name, spec } of CORPUS) {
      const runtimeVerdict = runtime(spec);
      const generatedVerdict = generated(spec);

      expect(generatedVerdict, `${name}: verdict`).toBe(runtimeVerdict);
      expect(readable(generated.errors), `${name}: errors`).toEqual(readable(runtime.errors));
      expect(deepestPaths(generated.errors), `${name}: deepest`).toEqual(
        deepestPaths(runtime.errors),
      );
    }
  });

  it("contains a schema-invalid fixture, so parity cannot pass vacuously", () => {
    const generated = getVegaLiteSchemaValidator();
    const refused = CORPUS.filter(({ spec }) => !generated(spec));

    expect(refused.map(({ name }) => name)).toContain("invalid/schema-invalid-encoding-type");
  });
});
