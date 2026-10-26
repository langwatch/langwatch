/**
 * Spec: specs/literal-ownership.feature (peer-route-literal).
 * Record: dev/docs/plans/platform-architecture-blocks.md rule 3.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { buildWorkspaceSnapshot } from "../../../workspace/snapshot.ts";
import {
  collectPeerRouteLiterals,
  lintPeerRouteLiterals,
  peerRouteLiteralKey,
} from "../peer-route-literal.ts";

let root = "";

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "langwatch-peer-route-"));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function write({ path, content }: { path: string; content: string }): void {
  const file = join(root, path);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, content);
}

function declareScreens({ paths }: { paths: readonly string[] }): void {
  const screens = paths.map((path) => `  "${path}": { path: "${path}", load: page },`).join("\n");
  write({
    path: "modules/a/browser/src/a.web.ts",
    content: `const page = () => null;\nexport const aWeb = screens({\n${screens}\n});\n`,
  });
}

function keys(): string[] {
  return collectPeerRouteLiterals(buildWorkspaceSnapshot({ root, changedFiles: [] })).map(
    peerRouteLiteralKey,
  );
}

describe("peer-route-literal", () => {
  describe("when a peer module spells an owner's screen address", () => {
    /** @scenario "A literal spelling a peer module's screen address is reported" */
    it("reports the literal against the owner's address", () => {
      declareScreens({ paths: ["/settings/widgets"] });
      write({
        path: "modules/b/browser/src/link.ts",
        content: 'export const href = "/settings/widgets?tab=one";\n',
      });

      expect(keys()).toEqual(["modules/b/browser/src/link.ts|/settings/widgets"]);
    });
  });

  describe("when an app fills the address parameter in a template literal", () => {
    /** @scenario "A template literal filling a peer's address parameter is reported" */
    it("reports the template against the parameterised address", () => {
      declareScreens({ paths: ["/:project/widgets"] });
      write({
        path: "apps/ui/src/link.ts",
        content: "export const href = (slug: string, id: string) => `/${slug}/widgets/${id}`;\n",
      });

      expect(keys()).toEqual(["apps/ui/src/link.ts|/:project/widgets"]);
    });
  });

  describe("when the literal is the owner's own or names another address", () => {
    /** @scenario "The owner's own literals and unrelated addresses are not reported" */
    it("reports nothing", () => {
      declareScreens({ paths: ["/settings/widgets", "/settings"] });
      write({
        path: "modules/a/browser/src/own-link.ts",
        content: 'export const href = "/settings/widgets";\n',
      });
      write({
        path: "modules/b/browser/src/links.ts",
        content: 'export const one = "/settings/other";\nexport const two = "/widgets/settings";\n',
      });
      write({
        path: "modules/b/browser/src/__tests__/links.unit.test.ts",
        content: 'export const tested = "/settings/widgets";\n',
      });

      expect(keys()).toEqual([]);
    });
  });

  describe("when a finding is reported", () => {
    /** @scenario "A peer route finding names the owner and what to do instead" */
    it("names the owner and its href builder", () => {
      declareScreens({ paths: ["/settings/widgets"] });
      write({
        path: "modules/b/browser/src/link.ts",
        content: 'export const href = "/settings/widgets";\n',
      });

      const [finding] = lintPeerRouteLiterals(buildWorkspaceSnapshot({ root, changedFiles: [] }));

      expect(finding).toMatchObject({ file: "modules/b/browser/src/link.ts", line: 1 });
      expect(finding?.message).toContain("modules/a");
      expect(finding?.allowed).toContain("modules/a's exported href builder");
    });
  });
});
