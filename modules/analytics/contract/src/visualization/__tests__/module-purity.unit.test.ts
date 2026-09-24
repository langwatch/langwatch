/**
 * Modules load in Node with no window/document—static imports assert no React,
 * DOM, or browser Vega.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { createNoNetworkVegaLoader } from "../no-network-vega-loader.ts";
import { parseVegaLiteSpecText, validateVegaLiteSpec } from "../validate-vega-lite-spec.ts";
import { screenVegaExpression } from "../vega-lite-expressions.ts";
import { validateFieldReferences } from "../vega-lite-fields.ts";
import {
  ALLOWED_VEGA_LITE_TRANSFORMS,
  applyLangWatchQLVegaPolicy,
  LWQL_VEGA_LIMITS,
  LWQL_VEGA_RULES,
} from "../vega-lite-policy.ts";
import {
  getVegaLiteSchemaValidator,
  VEGA_LITE_SCHEMA_URL,
  validateAgainstVegaLiteSchema,
} from "../vega-lite-schema.ts";
import { collectViewNodes, computeSpecBytes } from "../vega-lite-structure.ts";
import { LWQL_VEGA_RULE_IDS, VEGA_VALIDATION_ERROR_CODES } from "../visualization-types.ts";

/** `…/visualization/__tests__` → `…/visualization` */
const MODULE_DIR = fileURLToPath(new URL("..", import.meta.url));

/** Type-only import/export pattern to strip before checking for browser runtimes. */
const TYPE_ONLY_STATEMENT = /(?:^|\n)\s*(?:import|export)\s+type\b[\s\S]*?from\s+["'][^"']+["']/g;

/**
 * Modules that would drag a browser runtime into the policy. `vega-lite` is
 * absent from this list on purpose: the schema module imports its bundled JSON
 * schema, which is data and evaluates nothing.
 */
const BROWSER_RUNTIME_MODULE =
  /from\s+["'](react|react-dom|react-vega|vega|vega-embed|vega-view|@chakra-ui\/[^"']+)["']/;

/**
 * Whether a module *evaluates* a browser runtime. Type-only imports are
 * stripped first, since they are erased before anything runs.
 */
function importsBrowserRuntime(source: string): boolean {
  return BROWSER_RUNTIME_MODULE.test(source.replace(TYPE_ONLY_STATEMENT, ""));
}

const sourceFiles = () =>
  readdirSync(MODULE_DIR, { recursive: true, withFileTypes: true })
    .filter(
      (entry) =>
        entry.isFile() &&
        /\.tsx?$/.test(entry.name) &&
        !entry.name.endsWith(".d.ts") &&
        !entry.parentPath.split(/[/\\]/).includes("__tests__"),
    )
    .map((entry) => {
      const name = join(entry.parentPath, entry.name).slice(MODULE_DIR.length);
      return {
        name,
        source: readFileSync(join(entry.parentPath, entry.name), "utf8"),
      };
    });

describe("the Vega-Lite validator and policy modules", () => {
  describe("given the modules are imported outside a browser", () => {
    describe("when the policy runs", () => {
      /** @scenario "Vega dependencies and browser runtime stay behind the lazy boundary" */
      it("evaluates no React, DOM, or browser-only Vega module", () => {
        expect(typeof window).toBe("undefined");
        expect(typeof document).toBe("undefined");

        const files = sourceFiles();
        expect(files.length).toBeGreaterThan(5);
        for (const { name, source } of files) {
          expect(importsBrowserRuntime(source), `${name} imports a browser runtime`).toBe(false);
          expect(source.includes("import("), `${name} uses a lazy import`).toBe(false);
        }

        // The schema module never calls `ajv.compile` at runtime; it uses the
        // ahead-of-time generated validator, since `new Function` is what a
        // CSP without `unsafe-eval` refuses.
        const schemaSource = files.find(({ name }) => name === "vega-lite-schema.ts")?.source ?? "";
        expect(schemaSource).toContain('from "./vega-lite-schema-validator.generated.js"');
        expect(schemaSource).not.toMatch(/from\s+["']vega-lite[^"']*["']/);
        expect(schemaSource).not.toMatch(/new Ajv|\.compile\(/);

        // Every exported entry point runs to completion here, under node.
        expect(typeof getVegaLiteSchemaValidator()).toBe("function");
        expect(
          validateVegaLiteSpec({
            spec: {
              $schema: VEGA_LITE_SCHEMA_URL,
              data: { name: "d" },
              mark: "bar",
            },
            columnsByDataset: { d: [{ name: "a", type: "String" }] },
            rowCountsByDataset: { d: 1 },
          }).ok,
        ).toBe(true);
        expect(validateAgainstVegaLiteSchema({ mark: "bar" })).not.toEqual([]);
        expect(
          applyLangWatchQLVegaPolicy({
            spec: { data: { name: "d" }, mark: "bar" },
            registeredDatasets: ["d"],
          }).errors,
        ).toEqual([]);
        expect(
          validateFieldReferences({
            spec: { mark: "bar" },
            columnsByDataset: {},
          }).errors,
        ).toEqual([]);
        expect(screenVegaExpression("datum.a + 1").forbiddenIdentifiers).toEqual([]);
        expect(collectViewNodes({ mark: "bar" })).toHaveLength(1);
        expect(computeSpecBytes({ a: 1 })).toBe(7);
        expect(parseVegaLiteSpecText("{}").ok).toBe(true);
        expect(typeof createNoNetworkVegaLoader().load).toBe("function");
      });

      it("keeps the rule identifiers, codes, limits and allowlists enumerable", () => {
        expect(LWQL_VEGA_RULE_IDS.length).toBe(LWQL_VEGA_RULES.length);
        expect(VEGA_VALIDATION_ERROR_CODES.length).toBeGreaterThan(0);
        expect(Object.keys(LWQL_VEGA_LIMITS).toSorted()).toEqual([
          "maxExpressionBytes",
          "maxInteractiveParams",
          "maxLayersPerView",
          "maxNestingDepth",
          "maxRowsAllDatasets",
          "maxRowsPerDataset",
          "maxSpecBytes",
          "maxTotalExpressionBytes",
          "maxTransforms",
          "maxUnitViews",
        ]);
        expect(ALLOWED_VEGA_LITE_TRANSFORMS).toContain("filter");
      });
    });
  });
  describe("given the guard's own pattern", () => {
    describe("when it is shown each import form", () => {
      /** @scenario "Vega dependencies and browser runtime stay behind the lazy boundary" */
      it("catches every value import and admits every type-only one", () => {
        // Guard catches value imports, admits type-only ones (erased before run).
        // Lookbehind is error-prone, so both halves are pinned.
        const caught = [
          'import { View } from "vega";',
          'import vegaEmbed from "vega-embed";',
          'import { useState } from "react";',
          'import { Box } from "@chakra-ui/react";',
          // A type-only import earlier in the file must not shield a value
          // import later in it.
          'import type { Loader } from "vega";\nimport { View } from "vega";',
        ];
        const admitted = [
          'import type { Loader } from "vega";',
          'export type { Loader } from "vega";',
          'import type { Loader as VegaLoader } from "vega";',
          'import type {\n  Loader,\n} from "vega";',
          'import type { EmbedOptions } from "vega-embed";',
        ];

        for (const source of caught) {
          expect(importsBrowserRuntime(source), `should catch: ${source}`).toBe(true);
        }
        for (const source of admitted) {
          expect(importsBrowserRuntime(source), `should admit: ${source}`).toBe(false);
        }
      });
    });
  });
});
