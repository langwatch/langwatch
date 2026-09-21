import { afterAll, describe, expect, it } from "vitest";

import { designSystemExportCollisionRule } from "../../src/index.mjs";
import { createFixtureWorkspace, runRule } from "../../src/testing.mjs";

const workspace = createFixtureWorkspace({
  features: { agent: { layoutVersion: 0, roles: { browser: {} } } },
  files: {
    "packages/design-system/package.json": JSON.stringify({
      name: "@langwatch/design-system",
      exports: {
        "./copy-icon": { default: "./src/components/copy-icon.tsx" },
        "./format-money": { default: "./src/format-money.ts" },
      },
    }),
    "packages/design-system/src/components/copy-icon.tsx":
      "export function CopyIcon() { return null; }",
    "packages/design-system/src/format-money.ts":
      "export function formatMoney() { return '$0.00'; }",
    "modules/agent/browser/package.json": JSON.stringify({
      name: "@langwatch/agent-browser",
      exports: {
        "./copy-icon": { default: "./src/copy-icon.ts" },
        "./format-money": { default: "./src/format-money.ts" },
        "./agent-card": { default: "./src/agent-card.ts" },
      },
    }),
    "modules/agent/browser/src/copy-icon.ts": "export * from './ui/copy-icon.tsx';",
    "modules/agent/browser/src/ui/copy-icon.tsx": "export function CopyIcon() { return null; }",
    "modules/agent/browser/src/format-money.ts": "export function FormatMoney() { return null; }",
    "modules/agent/browser/src/agent-card.ts": "export function AgentCard() { return null; }",
    "modules/agent/browser/src/ui/internal-copy-icon.tsx":
      "export function CopyIcon() { return null; }",
  },
});

afterAll(() => workspace.cleanup());

function report(code, filename) {
  return runRule(designSystemExportCollisionRule, { code, cwd: workspace.cwd, filename });
}

describe("given a feature web package", () => {
  describe("when a public entry exports a component already owned by the design system", () => {
    /** @scenario "A feature web package cannot republish a design-system component" */
    it("reports the duplicate component and its canonical import", () => {
      const found = report(
        "export * from './ui/copy-icon.tsx';",
        "modules/agent/browser/src/copy-icon.ts",
      );

      expect(found).toHaveLength(1);
      expect(found[0].messageId).toBe("duplicateComponent");
      expect(found[0].data).toEqual({
        designSystemImport: "@langwatch/design-system/copy-icon",
        featurePackage: "@langwatch/agent-browser",
        name: "CopyIcon",
      });
      expect(found[0].message).toBe(
        "`CopyIcon` is exported by both `@langwatch/agent-browser` and" +
          " `@langwatch/design-system/copy-icon`. Import `CopyIcon` from" +
          " `@langwatch/design-system/copy-icon`, repoint every consumer, and delete this" +
          " feature-package export.",
      );
    });
  });

  describe("when similarly named exports have different runtime symbols", () => {
    it("does not confuse formatMoney with FormatMoney", () => {
      expect(
        report(
          "export function FormatMoney() { return null; }",
          "modules/agent/browser/src/format-money.ts",
        ),
      ).toEqual([]);
    });
  });

  describe("when a colliding component is not part of the package exports", () => {
    it("leaves the internal module alone", () => {
      expect(
        report(
          "export function CopyIcon() { return null; }",
          "modules/agent/browser/src/ui/internal-copy-icon.tsx",
        ),
      ).toEqual([]);
    });
  });

  describe("when the feature exports its own component", () => {
    it("leaves the distinct component alone", () => {
      expect(
        report(
          "export function AgentCard() { return null; }",
          "modules/agent/browser/src/agent-card.ts",
        ),
      ).toEqual([]);
    });
  });
});
