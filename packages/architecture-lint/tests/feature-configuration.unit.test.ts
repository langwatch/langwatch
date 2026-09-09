import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { lintFeatureConfiguration } from "../src/policies/feature-configuration.ts";
import type { FeatureCatalogueEntry } from "../src/types.ts";
import { snapshotOf } from "./workspace.ts";

let root: string;

const catalogue: FeatureCatalogueEntry[] = [
  {
    classification: "core",
    id: "widget",
    root: "packages/features/widget",
    subjects: ["widget"],
  },
  {
    classification: "core",
    id: "gadget",
    root: "packages/features/gadget",
    subjects: ["gadget"],
  },
];

function write(file: string, text: string): void {
  const target = join(root, file);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, text);
}

function findings(): ReturnType<typeof lintFeatureConfiguration> {
  return lintFeatureConfiguration(snapshotOf({ root, catalogue }));
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "feature-configuration-"));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("feature configuration", () => {
  describe("given a feature that declares its own schema", () => {
    /** @scenario "A feature reads its configuration through its own schema" */
    it("accepts it", () => {
      write(
        "packages/features/widget/contract/src/widget.config.ts",
        'export const widgetServerConfigSchema = 1; const leaf = { env: "WIDGET_URL" };',
      );

      expect(findings()).toEqual([]);
    });
  });

  describe("given a configuration module with no schema of its own", () => {
    /** @scenario "A feature reads its configuration through its own schema" */
    it("refuses it and names the export it needs", () => {
      write(
        "packages/features/widget/contract/src/widget.config.ts",
        'const leaf = { env: "WIDGET_URL" };',
      );

      expect(findings()).toHaveLength(1);
      expect(findings()[0]?.allowed).toContain("widgetServerConfigSchema");
    });
  });

  describe("given two features that both bind one variable", () => {
    /** @scenario "One variable has one owner across every process" */
    it("refuses the second and names the first", () => {
      write(
        "packages/features/widget/contract/src/widget.config.ts",
        'export const widgetServerConfigSchema = 1; const leaf = { env: "SHARED_URL" };',
      );
      write(
        "packages/features/gadget/contract/src/gadget.config.ts",
        'export const gadgetServerConfigSchema = 1; const leaf = { env: "SHARED_URL" };',
      );

      const violations = findings();
      expect(violations).toHaveLength(1);
      expect(violations[0]?.message).toContain("packages/features/widget/contract");
    });
  });

  describe("given an application that declares a second leaf for a feature's variable", () => {
    /** @scenario "One variable has one owner across every process" */
    it("refuses it and points at the feature's own definition", () => {
      write(
        "packages/features/widget/contract/src/widget.config.ts",
        'export const widgetServerConfigSchema = 1; const leaf = { env: "WIDGET_URL" };',
      );
      write(
        "apps/api/src/platform/config/api.config.ts",
        'const leaf = Config.value(schema, { env: "WIDGET_URL" });',
      );

      const violations = findings();
      expect(violations).toHaveLength(1);
      expect(violations[0]?.file).toContain("api.config.ts");
      expect(violations[0]?.allowed).toContain("Spread the feature's own configuration definition");
    });
  });

  describe("given an application leaf for a variable no feature owns", () => {
    /** @scenario "A feature reads its configuration through its own schema" */
    it("leaves it alone, since infrastructure belongs to the process", () => {
      write(
        "apps/api/src/platform/config/api.config.ts",
        'const leaf = Config.value(schema, { env: "DATABASE_URL" });',
      );

      expect(findings()).toEqual([]);
    });
  });
});
