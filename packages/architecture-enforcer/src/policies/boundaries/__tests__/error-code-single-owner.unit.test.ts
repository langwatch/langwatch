/** Spec: specs/module-ownership.feature. Record: dev/docs/ARCHITECTURE.md §17, rule 13c. */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { forgetFileListings } from "../../../workspace/layout.ts";
import {
  collectErrorCodeDeclarations,
  lintErrorCodeSingleOwner,
  sharedErrorCodes,
} from "../error-code-single-owner.ts";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
  forgetFileListings();
});

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "error-code-single-owner-"));
  roots.push(root);
  const write = (file: string, text: string) => {
    mkdirSync(dirname(join(root, file)), { recursive: true });
    writeFileSync(join(root, file), text);
  };
  const declarers = () =>
    [...sharedErrorCodes({ root })].map(([code, items]) => [
      code,
      items.map((item) => item.declarer),
    ]);

  return { root, write, declarers };
}

function errorClass({ name, code }: { name: string; code: string }): string {
  return `export class ${name} extends HandledError {\n  declare readonly code: "${code}";\n  constructor() {\n    super("${code}", "message");\n  }\n}\n`;
}

describe("error-code-single-owner", () => {
  describe("given classes in two modules declaring widget_missing", () => {
    describe("when the tree is read", () => {
      /** @scenario "A code declared by two classes is reported once per class" */
      it("reports the code with both classes", () => {
        const workspace = fixture();
        workspace.write(
          "modules/a/contract/src/a.errors.ts",
          errorClass({ name: "AWidgetMissingError", code: "widget_missing" }),
        );
        workspace.write(
          "modules/b/contract/src/b.errors.ts",
          errorClass({ name: "BWidgetMissingError", code: "widget_missing" }),
        );

        expect(workspace.declarers()).toEqual([
          ["widget_missing", ["AWidgetMissingError", "BWidgetMissingError"]],
        ]);
      });
    });
  });

  describe("given two classes declaring validation_error", () => {
    describe("when the tree is read", () => {
      /** @scenario "A generic kind of failure is shared on purpose" */
      it("reports nothing", () => {
        const workspace = fixture();
        workspace.write(
          "modules/a/contract/src/a.errors.ts",
          errorClass({ name: "ABadInputError", code: "validation_error" }),
        );
        workspace.write(
          "modules/b/contract/src/b.errors.ts",
          errorClass({ name: "BBadInputError", code: "validation_error" }),
        );

        expect(workspace.declarers()).toEqual([]);
      });
    });
  });

  describe("given a Go service and a class declaring widget_missing", () => {
    describe("when the tree is read", () => {
      /** @scenario "A generated Go service code counts as a declaration" */
      it("reports the class and the Go service", () => {
        const workspace = fixture();
        workspace.write(
          "packages/handled-error/src/codes.generated.ts",
          'export const goErrorCodes = {\n  widget_missing: { service: "aigateway" },\n} as const;\n',
        );
        workspace.write(
          "modules/a/contract/src/a.errors.ts",
          errorClass({ name: "AWidgetMissingError", code: "widget_missing" }),
        );

        expect(workspace.declarers()).toEqual([
          ["widget_missing", ["AWidgetMissingError", "goErrorCodes.aigateway"]],
        ]);
      });
    });
  });

  describe("given a class extending Error passing a word to super", () => {
    describe("when the tree is read", () => {
      /** @scenario "A message passed to a built-in Error is not a code" */
      it("records no declaration", () => {
        const workspace = fixture();
        workspace.write(
          "packages/x/src/timeout.ts",
          'export class TimeoutError extends Error {\n  constructor() {\n    super("timeout");\n  }\n}\n',
        );

        expect(collectErrorCodeDeclarations({ root: workspace.root })).toEqual([]);
      });
    });
  });

  describe("given a code two classes declare", () => {
    describe("when the finding is linted", () => {
      /** @scenario "An error-code-single-owner finding says what to do instead" */
      it("tells it to keep one owner or split the code", () => {
        const workspace = fixture();
        workspace.write(
          "modules/a/contract/src/a.errors.ts",
          errorClass({ name: "AWidgetMissingError", code: "widget_missing" }),
        );
        workspace.write(
          "modules/b/contract/src/b.errors.ts",
          errorClass({ name: "BWidgetMissingError", code: "widget_missing" }),
        );
        const findings = lintErrorCodeSingleOwner({
          root: workspace.root,
        } as Parameters<typeof lintErrorCodeSingleOwner>[0]);

        expect(findings).toHaveLength(2);
        expect(findings[0]?.message).toContain(
          "Error code widget_missing is declared by 2 classes",
        );
        expect(findings[0]?.allowed).toContain("Keep one class as the code's owner");
      });
    });
  });
});
