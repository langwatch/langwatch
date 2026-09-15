import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  collectUnusedModuleExportBaseline,
  collectUnusedModuleExportFindings,
  formatBaseline,
  lintUnusedModuleExports,
  UNUSED_MODULE_EXPORT_BASELINE,
} from "../src/index.ts";
import { snapshotOf } from "./workspace.ts";

let root = "";

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "unused-module-export-"));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function write(path: string, content: string): void {
  const absolute = join(root, path);
  mkdirSync(dirname(absolute), { recursive: true });
  writeFileSync(absolute, content, "utf8");
}

const SERVER = "modules/widget/server/src";

const BASELINE = "packages/architecture-enforcer/src/unused-module-export-baseline.json";

/** Rows keyed `<path>|<name>`, written the way the one writer writes them. */
function baselineText(keys: readonly string[]): string {
  return formatBaseline({
    policy: UNUSED_MODULE_EXPORT_BASELINE,
    entries: keys.map((key) => ({ key, measured: "2026-09-10" })),
  });
}

function findings(): ReturnType<typeof collectUnusedModuleExportFindings> {
  return collectUnusedModuleExportFindings({ root });
}

describe("unused module exports", () => {
  describe("given a module server file exporting a name nothing imports", () => {
    /** @scenario "An export nothing imports is reported against the file that declares it" */
    it("reports the file and the name with the instruction to delete or publish it", () => {
      write(`${SERVER}/rules/pricing.rules.ts`, "export const rate = 3;\n");
      write(`${SERVER}/index.ts`, "export const widget = 1;\n");

      const found = findings();

      expect(found).toHaveLength(1);
      expect(found[0]).toMatchObject({
        path: `${SERVER}/rules/pricing.rules.ts`,
        name: "rate",
      });
      expect(found[0]!.message).toContain("no file in the repository imports it");
      expect(found[0]!.allowed).toContain("export it from `index.ts`");
    });

    it("names every kind of declaration a file publishes", () => {
      write(
        `${SERVER}/rules/shapes.rules.ts`,
        [
          "export const value = 1;",
          "export function build(): number { return 1; }",
          "export class Widget {}",
          "export interface Shape { id: string }",
          "export type Size = 1 | 2;",
          "export enum Colour { Red }",
        ].join("\n"),
      );

      expect(
        findings()
          .map((one) => one.name)
          .sort(),
      ).toEqual(["Colour", "Shape", "Size", "Widget", "build", "value"]);
    });
  });

  describe("given a name the package index re-exports", () => {
    /** @scenario "A name the package index re-exports is part of the public surface" */
    it("reports nothing, because a published name is another guard's question", () => {
      write(`${SERVER}/rules/pricing.rules.ts`, "export const rate = 3;\n");
      write(`${SERVER}/index.ts`, 'export { rate } from "./rules/pricing.rules.ts";\n');

      expect(findings()).toEqual([]);
    });

    it("treats a star re-export as publishing every name the file declares", () => {
      write(`${SERVER}/rules/pricing.rules.ts`, "export const rate = 3;\nexport const cap = 9;\n");
      write(`${SERVER}/index.ts`, 'export * from "./rules/pricing.rules.ts";\n');

      expect(findings()).toEqual([]);
    });
  });

  describe("given a reference that names no member", () => {
    /** @scenario "A namespace import names no member, so it reads the whole module" */
    it("leaves every export of a namespace-imported module alone", () => {
      write(`${SERVER}/rules/pricing.rules.ts`, "export const rate = 3;\nexport const cap = 9;\n");
      write(
        `${SERVER}/services/pricing.service.ts`,
        'import * as pricing from "../rules/pricing.rules.ts";\nexport const price = pricing.rate;\n',
      );
      write(`${SERVER}/index.ts`, 'export { price } from "./services/pricing.service.ts";\n');

      expect(findings()).toEqual([]);
    });

    it("follows a private subpath import the package declares", () => {
      write(
        "modules/widget/server/package.json",
        JSON.stringify({
          name: "@langwatch/widget-server",
          exports: { ".": "./src/index.ts" },
          imports: { "#rules/*": "./src/rules/*.ts" },
        }),
      );
      write(`${SERVER}/rules/pricing.rules.ts`, "export const rate = 3;\n");
      write(
        `${SERVER}/widget.server.ts`,
        'import { rate } from "#rules/pricing.rules";\nexport const widget = rate;\n',
      );
      write(`${SERVER}/index.ts`, 'export { widget } from "./widget.server.ts";\n');

      expect(findings()).toEqual([]);
    });
  });

  describe("given a file written to be read by a suite", () => {
    /** @scenario "A test file's own exports are not checked" */
    it("checks neither a test, a fixture folder nor a testing entry", () => {
      write(`${SERVER}/__tests__/widget.fixture.ts`, "export const fixture = 1;\n");
      write(`${SERVER}/rules/pricing.unit.test.ts`, "export const helper = 1;\n");
      write(`${SERVER}/testing.ts`, "export const harness = 1;\n");
      write(`${SERVER}/index.ts`, "export const widget = 1;\n");

      expect(findings()).toEqual([]);
    });
  });

  describe("given a baseline", () => {
    /** @scenario "A baselined unused export is silent and a stale baseline entry is reported" */
    it("silences listed findings and refuses an entry that no longer holds", () => {
      write(`${SERVER}/rules/pricing.rules.ts`, "export const rate = 3;\n");
      write(
        BASELINE,
        baselineText([
          `${SERVER}/rules/pricing.rules.ts|rate`,
          `${SERVER}/rules/gone.rules.ts|cap`,
        ]),
      );

      const violations = lintUnusedModuleExports(snapshotOf({ root }));

      expect(violations.map((violation) => violation.policy)).toEqual([
        "unused-module-export-baseline",
      ]);
      expect(violations[0]!.message).toContain(
        `${SERVER}/rules/gone.rules.ts cap no longer matches anything`,
      );
    });

    it("reports an unlisted finding under the policy name", () => {
      write(`${SERVER}/rules/pricing.rules.ts`, "export const rate = 3;\n");
      write(BASELINE, baselineText([`${SERVER}/rules/other.rules.ts|cap`]));

      const policies = lintUnusedModuleExports(snapshotOf({ root })).map(
        (violation) => violation.policy,
      );

      expect(policies).toContain("unused-module-export");
      expect(policies).toContain("unused-module-export-baseline");
    });

    it("collects the baseline as rows sorted by key, keeping the date a row carries", () => {
      write(`${SERVER}/rules/pricing.rules.ts`, "export const cap = 9;\nexport const rate = 3;\n");

      const entries = collectUnusedModuleExportBaseline({
        root,
        previous: [{ key: `${SERVER}/rules/pricing.rules.ts|cap`, measured: "2020-01-01" }],
      });

      expect(entries).toEqual([
        { key: `${SERVER}/rules/pricing.rules.ts|cap`, measured: "2020-01-01" },
        { key: `${SERVER}/rules/pricing.rules.ts|rate`, measured: expect.any(String) },
      ]);
    });
  });
});
