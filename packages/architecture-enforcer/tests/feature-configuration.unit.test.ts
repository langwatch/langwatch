import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { lintFeatureConfiguration } from "../src/policies/feature-configuration.ts";
import type { FeatureCatalogueEntry } from "../src/types.ts";
import { snapshotOf } from "./workspace.ts";

let root: string;

const catalogue: FeatureCatalogueEntry[] = [
  { classification: "core", id: "widget", root: "modules/widget", subjects: ["widget"] },
  { classification: "core", id: "gadget", root: "modules/gadget", subjects: ["gadget"] },
];

const DECLARED = `export const widgetConfig = Config.define((c) => ({
  apiUrl: c.env("WIDGET_API_URL", z.string()),
}));
export const widgetWebConfigSchema = z.strictObject({ enabled: z.boolean() });
`;

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
  describe("given a module declaring its config in its contract config module", () => {
    /** @scenario "A module declaring its configuration in its contract config module passes" */
    it("reports nothing and asks for no schema export", () => {
      write("modules/widget/contract/src/widget.config.ts", DECLARED);
      write("modules/gadget/contract/src/gadget.config.ts", "export const gadgetSecrets = {};\n");

      expect(findings()).toEqual([]);
    });
  });

  describe("given Config.define in a process service", () => {
    /** @scenario "Config.define outside the contract config module is refused" */
    it("reports the file and names the contract config module", () => {
      write("modules/widget/contract/src/widget.config.ts", DECLARED);
      write(
        "modules/widget/process/src/services/widget.service.ts",
        "export const extra = Config.define((c) => ({}));\n",
      );

      const found = findings();

      expect(found.map((entry) => entry.file)).toEqual([
        join(root, "modules/widget/process/src/services/widget.service.ts"),
      ]);
      expect(found[0]?.allowed).toContain("modules/widget/contract/src/widget.config.ts");
    });
  });

  describe("given a deleted config schema spelling", () => {
    /** @scenario "A deleted config schema spelling is refused" */
    it("reports a ServerConfigSchema or AppConfigSchema export as a §15 spelling", () => {
      write(
        "modules/widget/contract/src/widget.config.ts",
        "export const widgetServerConfigSchema = z.object({});\n",
      );
      write(
        "modules/gadget/contract/src/gadget.config.ts",
        "export const gadgetAppConfigSchema = z.object({});\n",
      );

      const messages = findings().map((entry) => entry.message);

      expect(messages).toHaveLength(2);
      expect(messages.every((message) => message.includes("§15"))).toBe(true);
      expect(messages.join(" ")).toContain("widgetServerConfigSchema");
      expect(messages.join(" ")).toContain("gadgetAppConfigSchema");
    });
  });

  describe("given a test calling Config.define and two modules binding one variable", () => {
    /** @scenario "Test files and two modules binding one variable are left to their own checks" */
    it("reports nothing", () => {
      const binding = `export const config = Config.define((c) => ({ url: c.env("SHARED_URL", s) }));\n`;
      write("modules/widget/contract/src/widget.config.ts", binding);
      write("modules/gadget/contract/src/gadget.config.ts", binding);
      write("modules/widget/process/src/services/__tests__/widget.unit.test.ts", binding);

      expect(findings()).toEqual([]);
    });
  });
});
