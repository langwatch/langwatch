/**
 * Server-import safety.
 *
 * This file declares no jsdom environment, so it runs under plain node with no
 * `window` and no `document`. The static imports at the top are the assertion:
 * if any policy module reached for React, the DOM, or the browser-only Vega
 * runtime, this file would throw before a single test ran.
 *
 * (Do not name the environment pragma in this comment even to say it is absent
 * — vitest reads the pragma out of the first docblock, and would switch this
 * file to the very environment it exists to prove is unnecessary.)
 *
 * The source scan is the second half, because a module can import a browser
 * runtime and still load — until it is asked to do something. The import graph
 * is what the bundler splits on, so it is the import graph that is pinned.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { createNoNetworkVegaLoader } from "../noNetworkVegaLoader";
import { parseVegaLiteSpecText, validateVegaLiteSpec } from "../validateVegaLiteSpec";
import { screenVegaExpression } from "../vegaLiteExpressions";
import { validateFieldReferences } from "../vegaLiteFields";
import {
  ALLOWED_VEGA_LITE_TRANSFORMS,
  applyLangWatchQLVegaPolicy,
  LWQL_VEGA_LIMITS,
  LWQL_VEGA_RULES,
} from "../vegaLitePolicy";
import {
  getVegaLiteSchemaValidator,
  VEGA_LITE_SCHEMA_URL,
  validateAgainstVegaLiteSchema,
} from "../vegaLiteSchema";
import { collectViewNodes, measureSpecBytes } from "../vegaLiteStructure";
import { LWQL_VEGA_RULE_IDS, VEGA_VALIDATION_ERROR_CODES } from "../visualization.types";

/** `…/visualization/__tests__` → `…/visualization` */
const MODULE_DIR = fileURLToPath(new URL("../", import.meta.url));

/**
 * A type-only `import`/`export` statement, however it wraps across lines.
 *
 * The lazy body stops at that statement's own `from "…"`, so a value import on
 * a following line is left alone rather than shielded by the type import above
 * it. This is a statement-level strip rather than a lookbehind on the module
 * pattern: a lookbehind cannot span a multiline `import type { … }` without
 * also reaching back across statement boundaries.
 */
const TYPE_ONLY_STATEMENT =
  /(?:^|\n)\s*(?:import|export)\s+type\b[\s\S]*?from\s+["'][^"']+["']/g;

/**
 * Modules that would drag a browser runtime into the policy. `vega-lite` is
 * absent from this list on purpose: the schema module imports its bundled JSON
 * schema, which is data and evaluates nothing.
 */
const BROWSER_RUNTIME_MODULE =
  /from\s+["'](react|react-dom|react-vega|vega|vega-embed|vega-view|@chakra-ui\/[^"']+)["']/;

/**
 * Whether a module *evaluates* a browser runtime.
 *
 * Type-only imports are stripped first because they are erased before anything
 * runs — which is what lets `noNetworkVegaLoader.ts` check its shape against
 * vega's own `Loader` at compile time without importing vega.
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
      /** @scenario "Policy modules stay pure and server-import-safe" */
      it("evaluates no React, DOM, or browser-only Vega module", () => {
        expect(typeof window).toBe("undefined");
        expect(typeof document).toBe("undefined");

        const files = sourceFiles();
        expect(files.length).toBeGreaterThan(5);
        for (const { name, source } of files) {
          expect(importsBrowserRuntime(source), `${name} imports a browser runtime`).toBe(
            false,
          );
          expect(source.includes("import("), `${name} uses a lazy import`).toBe(false);
        }

        // The schema module reaches the bundled schema only through the
        // ahead-of-time generated validator: it names no `vega-lite` module at
        // all, and compiles nothing at runtime. `new Function` is what a
        // Content-Security-Policy without `unsafe-eval` refuses, so a runtime
        // `ajv.compile` here would be the chart layer's validation quietly
        // dying in exactly the environment it is hardened for.
        const schemaSource =
          files.find(({ name }) => name === "vegaLiteSchema.ts")?.source ?? "";
        expect(schemaSource).toContain('from "./vegaLiteSchemaValidator.generated.js"');
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
        expect(measureSpecBytes({ a: 1 })).toBe(7);
        expect(parseVegaLiteSpecText("{}").ok).toBe(true);
        expect(typeof createNoNetworkVegaLoader().load).toBe("function");
      });

      it("keeps the rule identifiers, codes, limits and allowlists enumerable", () => {
        expect(LWQL_VEGA_RULE_IDS.length).toBe(LWQL_VEGA_RULES.length);
        expect(VEGA_VALIDATION_ERROR_CODES.length).toBeGreaterThan(0);
        expect(Object.keys(LWQL_VEGA_LIMITS).sort()).toEqual([
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
      /** @scenario "Policy modules stay pure and server-import-safe" */
      it("catches every value import and admits every type-only one", () => {
        // The guard exists to keep a browser runtime out of the policy, and a
        // type-only import brings none — it is erased before anything runs.
        // That distinction is a lookbehind, which is easy to get subtly wrong,
        // so both halves are pinned here rather than trusted: a pattern that
        // stopped catching value imports would disarm the guard without
        // failing anything, and one that rejected type-only imports would
        // force `noNetworkVegaLoader.ts` to drop its `Loader` conformance
        // check — the compile-time link that keeps the deny-everything loader
        // honest.
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
