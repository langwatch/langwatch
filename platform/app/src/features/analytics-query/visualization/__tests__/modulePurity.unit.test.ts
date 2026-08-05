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
import {
  parseVegaLiteSpecText,
  validateVegaLiteSpec,
} from "../validateVegaLiteSpec";
import { screenVegaExpression } from "../vegaLiteExpressions";
import { validateFieldReferences } from "../vegaLiteFields";
import {
  ALLOWED_VEGA_LITE_TRANSFORMS,
  applyGovernedVegaPolicy,
  GOVERNED_VEGA_LIMITS,
  GOVERNED_VEGA_RULES,
} from "../vegaLitePolicy";
import {
  getVegaLiteSchemaValidator,
  VEGA_LITE_SCHEMA_URL,
  validateAgainstVegaLiteSchema,
} from "../vegaLiteSchema";
import { collectViewNodes, measureSpecBytes } from "../vegaLiteStructure";
import {
  GOVERNED_VEGA_RULE_IDS,
  VEGA_VALIDATION_ERROR_CODES,
} from "../visualization.types";

/** `…/visualization/__tests__` → `…/visualization` */
const MODULE_DIR = fileURLToPath(new URL("../", import.meta.url));

/**
 * Imports that would drag a browser runtime into the policy. `vega-lite` is
 * absent from this list on purpose: the schema module imports its bundled JSON
 * schema, which is data and evaluates nothing.
 */
const BROWSER_RUNTIME_IMPORT =
  /from\s+["'](react|react-dom|react-vega|vega|vega-embed|vega-view|@chakra-ui\/[^"']+)["']/;

const sourceFiles = () =>
  readdirSync(MODULE_DIR)
    .filter((name) => name.endsWith(".ts") && !name.endsWith(".d.ts"))
    .map((name) => ({
      name,
      source: readFileSync(join(MODULE_DIR, name), "utf8"),
    }));

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
          expect(
            BROWSER_RUNTIME_IMPORT.test(source),
            `${name} imports a browser runtime`,
          ).toBe(false);
          expect(source.includes("import("), `${name} uses a lazy import`).toBe(
            false,
          );
        }

        // The schema module may name `vega-lite` exactly once, for its bundled
        // JSON schema, and never for the runtime.
        const schemaSource =
          files.find(({ name }) => name === "vegaLiteSchema.ts")?.source ?? "";
        expect(schemaSource).toContain(
          'from "vega-lite/vega-lite-schema.json"',
        );
        expect(schemaSource).not.toMatch(/from\s+["']vega-lite["']/);

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
          applyGovernedVegaPolicy({
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
        expect(
          screenVegaExpression("datum.a + 1").forbiddenIdentifiers,
        ).toEqual([]);
        expect(collectViewNodes({ mark: "bar" })).toHaveLength(1);
        expect(measureSpecBytes({ a: 1 })).toBe(7);
        expect(parseVegaLiteSpecText("{}").ok).toBe(true);
        expect(typeof createNoNetworkVegaLoader().load).toBe("function");
      });

      it("keeps the rule identifiers, codes, limits and allowlists enumerable", () => {
        expect(GOVERNED_VEGA_RULE_IDS.length).toBe(GOVERNED_VEGA_RULES.length);
        expect(VEGA_VALIDATION_ERROR_CODES.length).toBeGreaterThan(0);
        expect(Object.keys(GOVERNED_VEGA_LIMITS)).toHaveLength(10);
        expect(ALLOWED_VEGA_LITE_TRANSFORMS).toContain("filter");
      });
    });
  });
});
