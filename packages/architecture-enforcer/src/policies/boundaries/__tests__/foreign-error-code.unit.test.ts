/**
 * Spec: specs/foreign-error-code.feature. Record: dev/docs/plans/platform-architecture-blocks.md
 * rule 2 and its idiom.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { ClassifiedPackage } from "../../../types.ts";
import { forgetFileListings } from "../../../workspace/layout.ts";
import { buildWorkspaceSnapshot, type WorkspaceSnapshot } from "../../../workspace/snapshot.ts";
import { collectForeignErrorCodes, lintForeignErrorCodes } from "../foreign-error-code.ts";

let root = "";

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "langwatch-foreign-error-code-"));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
  forgetFileListings();
});

function write({ path, content }: { path: string; content: string }): void {
  const file = join(root, path);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, content);
}

function contract(module: string): ClassifiedPackage {
  const packageRoot = join(root, "modules", module, "contract");

  return {
    name: `@langwatch/${module}-contract`,
    root: packageRoot,
    manifestPath: join(packageRoot, "package.json"),
    manifest: {},
    kind: "contract",
    feature: module,
    enterprise: false,
  };
}

function snapshot(): WorkspaceSnapshot {
  const read = buildWorkspaceSnapshot({ root, changedFiles: [] });

  const framework: ClassifiedPackage = {
    ...contract("widgets"),
    name: "@langwatch/widgets",
    root: join(root, "packages", "widgets"),
    manifestPath: join(root, "packages", "widgets", "package.json"),
    kind: "tooling",
    feature: undefined,
  };

  return { ...read, packages: [contract("a"), contract("b"), framework] };
}

function errorClass({ name, code }: { name: string; code: string }): string {
  return `export class ${name} extends HandledError {\n  static readonly code = "${code}" as const;\n  declare readonly code: "${code}";\n  constructor() {\n    super("${code}", "message");\n  }\n}\n`;
}

function declareWidgetMissing(): void {
  write({
    path: "modules/a/contract/src/a.errors.ts",
    content: errorClass({ name: "WidgetMissingError", code: "widget_missing" }),
  });
}

function found(): string[] {
  return collectForeignErrorCodes(snapshot())
    .map((finding) => `${finding.file}:${finding.line}|${finding.use}`)
    .toSorted();
}

describe("foreign-error-code", () => {
  describe("given module a owns widget_missing", () => {
    describe("when module b compares an error's code to it", () => {
      /** @scenario "Comparing an error to a peer module's code is reported" */
      it("reports both comparisons", () => {
        declareWidgetMissing();
        write({
          path: "modules/b/process/src/one.ts",
          content:
            'export const gone = (error: { code: string }) => error.code === "widget_missing";\n',
        });
        write({
          path: "modules/b/browser/src/two.ts",
          content:
            'export const kept = (error: { code: string }) =>\n  "widget_missing" !== error.code;\n',
        });

        expect(found()).toEqual([
          "modules/b/browser/src/two.ts:2|comparison",
          "modules/b/process/src/one.ts:1|comparison",
        ]);
      });
    });

    describe("when the code is a case label, a record key and a membership list", () => {
      /** @scenario "A peer's code as a case label, a record key, a membership list or a const is reported" */
      it("reports every literal", () => {
        declareWidgetMissing();
        write({
          path: "apps/ui/src/switch.ts",
          content: [
            "export function label(code: string) {",
            "  switch (code) {",
            '    case "widget_missing":',
            '      return "gone";',
            "  }",
            "}",
            "",
          ].join("\n"),
        });
        write({
          path: "modules/b/browser/src/lists.ts",
          content: [
            'export const COPY = { widget_missing: "gone", "widget_missing": "twice" };',
            'export const KNOWN = new Set(["widget_missing"]);',
            'export const LISTED = ["widget_missing"] as const;',
            'export const isKnown = (code: string) => ["widget_missing"].includes(code);',
            'export const isListed = (codes: string[]) => codes.includes("widget_missing");',
            "export const inList = (code: string) => (LISTED as readonly string[]).includes(code);",
            'export const MISSING_CODE = "widget_missing";',
            "",
          ].join("\n"),
        });

        expect(found()).toEqual([
          "apps/ui/src/switch.ts:3|case",
          "modules/b/browser/src/lists.ts:1|record-key",
          "modules/b/browser/src/lists.ts:1|record-key",
          "modules/b/browser/src/lists.ts:2|membership",
          "modules/b/browser/src/lists.ts:3|membership",
          "modules/b/browser/src/lists.ts:4|membership",
          "modules/b/browser/src/lists.ts:5|membership",
          "modules/b/browser/src/lists.ts:7|alias",
        ]);
      });
    });

    describe("when module b tests a list with some or find, or asks a code-matching helper", () => {
      /** @scenario "A peer's code tested with some or find, or handed to a code-matching helper, is reported" */
      it("reports the lists and the helper argument, not an unrelated call", () => {
        declareWidgetMissing();
        write({
          path: "modules/b/process/src/match.ts",
          content: [
            'export const a = (e: { code: string }) => ["widget_missing"].some((c) => c === e.code);',
            'const KNOWN = ["widget_missing"];',
            "export const b = (e: { code: string }) => KNOWN.find((c) => c === e.code);",
            "declare function hasCode(error: unknown, code: string): boolean;",
            "declare function errorChainHas(error: unknown, code: string): boolean;",
            "declare function log(message: string, code: string): void;",
            'export const c = (e: unknown) => hasCode(e, "widget_missing");',
            'export const d = (e: unknown) => errorChainHas(e, "widget_missing");',
            'export const f = () => log("seen", "widget_missing");',
            "",
          ].join("\n"),
        });

        expect(found()).toEqual([
          "modules/b/process/src/match.ts:1|membership",
          "modules/b/process/src/match.ts:2|membership",
          "modules/b/process/src/match.ts:7|comparison",
          "modules/b/process/src/match.ts:8|comparison",
        ]);
      });
    });

    describe("when the owner compares it, a peer only prints it and a test compares it", () => {
      /** @scenario "The owner's own code, a peer's code as plain text and test files are not reported" */
      it("reports nothing", () => {
        declareWidgetMissing();
        write({
          path: "modules/a/process/src/own.ts",
          content:
            'export const gone = (error: { code: string }) => error.code === "widget_missing";\n',
        });
        write({
          path: "modules/b/process/src/log.ts",
          content: [
            'export const line = () => console.log("widget_missing", { at: "widget_missing" });',
            'export const DECLARED = ["widget_missing"] as const;',
            "export function label(outcome: { outcome: string }) {",
            "  switch (outcome.outcome) {",
            '    case "widget_missing":',
            '      return "a tag of another union";',
            "  }",
            "}",
            "",
          ].join("\n"),
        });
        write({
          path: "modules/b/process/src/__tests__/b.unit.test.ts",
          content: 'expect(error.code === "widget_missing").toBe(true);\n',
        });

        expect(found()).toEqual([]);
      });
    });

    describe("when module b compares a generic and a generated code module a also declares", () => {
      /** @scenario "Generic codes and the services' generated codes are not module-owned" */
      it("reports nothing", () => {
        write({
          path: "packages/handled-error/src/handled-error.ts",
          content:
            'export class WidgetInvalidError extends HandledError {\n  constructor() {\n    super("widget_invalid", "m");\n  }\n}\n',
        });
        write({
          path: "packages/handled-error/src/codes.generated.ts",
          content:
            'export const goErrorCodes = {\n  widget_gone: { service: "aigateway" },\n} as const;\n',
        });
        write({
          path: "modules/a/contract/src/a.errors.ts",
          content: [
            errorClass({ name: "AInvalidError", code: "widget_invalid" }),
            errorClass({ name: "WidgetGoneError", code: "widget_gone" }),
          ].join("\n"),
        });
        write({
          path: "modules/b/process/src/codes.ts",
          content:
            'export const known = (code: string) => code === "widget_invalid" || code === "widget_gone";\n',
        });

        expect(found()).toEqual([]);
      });
    });

    describe("when the policy reports a comparison and a record key", () => {
      /** @scenario "A foreign error code finding names the class and the contract to import" */
      it("tells the author which class to import and how to use it", () => {
        declareWidgetMissing();
        write({
          path: "modules/b/process/src/one.ts",
          content: [
            'export const gone = (error: { code: string }) => error.code === "widget_missing";',
            'export const COPY = { widget_missing: "gone" };',
            "",
          ].join("\n"),
        });

        const [comparison, recordKey] = lintForeignErrorCodes(snapshot()).toSorted(
          (left, right) => (left.line ?? 0) - (right.line ?? 0),
        );

        expect(comparison?.policy).toBe("foreign-error-code");
        expect(comparison?.allowed).toContain(
          "Import WidgetMissingError from @langwatch/a-contract and use WidgetMissingError.is(error).",
        );
        expect(recordKey?.allowed).toContain("key the record by [WidgetMissingError.code]");
      });
    });
    describe("when a framework package declares the same code and another of its own", () => {
      /** @scenario "A framework package declaring a module's code is named as a second import" */
      it("reports the module's code with both classes, contract first", () => {
        declareWidgetMissing();
        write({
          path: "packages/widgets/src/errors.ts",
          content: [
            errorClass({ name: "FrameworkWidgetMissingError", code: "widget_missing" }),
            errorClass({ name: "WidgetFrameworkOnlyError", code: "widget_framework_only" }),
          ].join("\n"),
        });
        write({
          path: "modules/b/process/src/codes.ts",
          content:
            'export const known = (code: string) => code === "widget_missing" || code === "widget_framework_only";\n',
        });

        const findings = collectForeignErrorCodes(snapshot());

        expect(findings.map((finding) => finding.code)).toEqual(["widget_missing"]);
        expect(findings[0]?.owners.map((owner) => owner.className)).toEqual([
          "WidgetMissingError",
          "FrameworkWidgetMissingError",
        ]);
      });
    });
  });
});
