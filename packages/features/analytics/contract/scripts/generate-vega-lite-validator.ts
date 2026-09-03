/**
 * Compiles the bundled official Vega-Lite v6 JSON Schema into a standalone
 * validator module, ahead of time.
 *
 * ── WHY THIS SCRIPT EXISTS ─────────────────────────────────────────────────
 * Ajv compiles a schema by building a function with `new Function`. That needs
 * `script-src 'unsafe-eval'`. The chart runtime is deliberately built to run
 * under a Content-Security-Policy that forbids eval — that is the whole point
 * of handing Vega its expression interpreter — and a validator that dies under
 * the same policy would leave the chart layer accepting whatever it was given.
 *
 * Ajv's standalone code generation moves the `new Function` call to build time:
 * this script runs it once, on a developer's machine, and checks in the
 * resulting module. The browser only ever loads already-generated code.
 *
 * The schema is used verbatim, exactly as `vega-lite` publishes it. Nothing is
 * pruned, rewritten, or version-shifted, so "the bundled official schema
 * decides schema validity" stays literally true.
 *
 * Run:  pnpm generate:vega-validator
 * Pinned by: packages/features/analytics/web/tests/visualization/
 *            vega-lite-schema-validator.unit.test.ts, which regenerates from
 *            the installed schema and fails if the committed module has drifted,
 *            and separately compares its verdicts against a fresh runtime
 *            compile across the whole fixture corpus.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import Ajv from "ajv";
import standaloneCode from "ajv/dist/standalone";

const PACKAGE_ROOT = fileURLToPath(new URL("../", import.meta.url));

const require_ = createRequire(import.meta.url);

/**
 * The `exports` map is what publishes this path; on disk the file lives at
 * `build/vega-lite-schema.json`, which is not importable.
 */
export const VEGA_LITE_SCHEMA_SPECIFIER = "vega-lite/vega-lite-schema.json";

export const GENERATED_VALIDATOR_PATH =
  "src/visualization/vega-lite-schema-validator.generated.js";

export const GENERATED_VALIDATOR_TYPES_PATH =
  "src/visualization/vega-lite-schema-validator.generated.d.ts";

/**
 * The Ajv options the validator is compiled with. Exported so the drift guard
 * compiles with exactly these and cannot pass by disagreeing quietly.
 *
 * `allErrors` is load-bearing rather than generous: the Vega-Lite schema is a
 * forest of `anyOf` branches, so the first error is always a root-level "must
 * match a schema in anyOf", which names nothing a member could fix. It also
 * happens to generate *less* code here than `allErrors: false` does.
 */
export const VEGA_LITE_AJV_OPTIONS = {
  // The schema is draft-07 and uses union types and keywords Ajv would
  // otherwise refuse to compile.
  strict: false,
  allErrors: true,
  // The schema declares `color-hex`, which is not a JSON Schema format.
  validateFormats: false,
} as const;

/**
 * Ajv emits its two runtime helpers as `require(...)` calls even when asked for
 * ESM, so the generated source is rewritten to reach them through real imports.
 * Each appears exactly once, as `const funcN = require("…").default;`.
 */
const AJV_RUNTIME_IMPORTS: readonly {
  readonly specifier: string;
  readonly binding: string;
}[] = [
  { specifier: "ajv/dist/runtime/equal", binding: "ajvRuntimeEqual" },
  { specifier: "ajv/dist/runtime/ucs2length", binding: "ajvRuntimeUcs2Length" },
];

/** Reads the schema through the package's own `exports` map. */
export function readBundledVegaLiteSchema(): Record<string, unknown> {
  const path = require_.resolve(VEGA_LITE_SCHEMA_SPECIFIER);
  return JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
}

/**
 * Compiles the schema and returns the standalone module source, imports and
 * header included. Deterministic: the same schema and the same Ajv version
 * produce byte-identical output, which is what lets the drift guard compare
 * bytes rather than behaviour alone.
 */
export function generateVegaLiteValidatorSource(schema: Record<string, unknown>): string {
  const ajv = new Ajv({
    ...VEGA_LITE_AJV_OPTIONS,
    code: { source: true, esm: true },
  });
  const generated = standaloneCode(ajv, ajv.compile(schema));
  return `${moduleHeader()}${runtimeImports()}\n${rewriteRuntimeRequires(generated)}\n`;
}

function moduleHeader(): string {
  return [
    "// @ts-nocheck",
    "/* eslint-disable */",
    "/**",
    ` * GENERATED FILE — DO NOT EDIT.`,
    ` *`,
    ` * Regenerate with \`pnpm generate:vega-validator\`, which runs`,
    ` * \`scripts/generate-vega-lite-validator.ts\`. That script is the only`,
    ` * place the Ajv options live.`,
    ` *`,
    ` * Source schema: ${VEGA_LITE_SCHEMA_SPECIFIER} (the official Vega-Lite v6`,
    ` * JSON Schema, verbatim). Compiled ahead of time because Ajv's runtime`,
    ` * compiler needs \`unsafe-eval\`, and the chart runtime must work without it.`,
    " */",
    "",
  ].join("\n");
}

/**
 * Ajv's runtime helpers are CommonJS with an `__esModule` marker, so a bundler
 * unwraps the default export while plain Node ESM hands back the whole module
 * object. Taking `.default` when it is there covers both without a build flag.
 */
function runtimeImports(): string {
  const lines = AJV_RUNTIME_IMPORTS.flatMap(({ specifier, binding }) => [
    `import ${binding}Module from "${specifier}";`,
  ]);
  const bindings = AJV_RUNTIME_IMPORTS.map(
    ({ binding }) => `const ${binding} = ${binding}Module.default ?? ${binding}Module;`,
  );
  return [...lines, ...bindings, ""].join("\n");
}

function rewriteRuntimeRequires(source: string): string {
  return AJV_RUNTIME_IMPORTS.reduce((current, { specifier, binding }) => {
    const call = `require("${specifier}").default`;
    if (!current.includes(call)) {
      throw new Error(
        `generate-vega-lite-validator: expected ${call} in the generated source. Ajv's output shape changed; the rewrite has to be revisited.`,
      );
    }
    return current.split(call).join(binding);
  }, source);
}

/** The hand-written types for the generated module. */
export function generateVegaLiteValidatorTypes(): string {
  return [
    "/**",
    " * GENERATED FILE — DO NOT EDIT.",
    " *",
    " * Regenerate with `pnpm generate:vega-validator`.",
    " *",
    " * The generated validator is plain JavaScript; this is the shape Ajv's",
    " * standalone output actually has, declared so the chart layer keeps its",
    " * types without the 7 MB of generated code entering the type graph.",
    " */",
    "",
    'import type { ErrorObject } from "ajv";',
    "",
    "export interface VegaLiteSchemaValidator {",
    "  (data: unknown): boolean;",
    "  errors?: ErrorObject[] | null;",
    "}",
    "",
    "export declare const validate: VegaLiteSchemaValidator;",
    "export default validate;",
    "",
  ].join("\n");
}

function main(): void {
  const schema = readBundledVegaLiteSchema();
  const source = generateVegaLiteValidatorSource(schema);

  writeFileSync(resolve(PACKAGE_ROOT, GENERATED_VALIDATOR_PATH), source, "utf8");
  writeFileSync(
    resolve(PACKAGE_ROOT, GENERATED_VALIDATOR_TYPES_PATH),
    generateVegaLiteValidatorTypes(),
    "utf8",
  );

  const megabytes = (Buffer.byteLength(source, "utf8") / 1024 / 1024).toFixed(2);
  console.log(`Wrote ${GENERATED_VALIDATOR_PATH} (${megabytes} MB) and its declaration.`);
}

// `tsx scripts/generate-vega-lite-validator.ts` writes the files; the drift
// guard imports the exports above and writes nothing.
const entryPoint = process.argv[1];
if (entryPoint !== undefined && fileURLToPath(import.meta.url) === resolve(entryPoint)) {
  main();
}
