import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { collectUnusedModuleExportFindings } from "../src/index.ts";

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

const SERVER = "modules/widget/process/src";

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
          .toSorted(),
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
        "modules/widget/process/package.json",
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
});
