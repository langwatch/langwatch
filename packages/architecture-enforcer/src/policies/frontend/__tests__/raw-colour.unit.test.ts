/**
 * Spec: packages/architecture-enforcer/specs/design-system-use.feature.
 * Record: ARCHITECTURE.md §17.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { buildWorkspaceSnapshot } from "../../../workspace/snapshot.ts";
import { lintRawColours } from "../raw-colour.ts";

let root = "";

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "langwatch-raw-colour-"));
  write("pnpm-workspace.yaml", 'packages:\n  - "modules/*/*"\n');
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function write(path: string, content: string): void {
  const absolute = join(root, path);
  mkdirSync(dirname(absolute), { recursive: true });
  writeFileSync(absolute, content, "utf8");
}

function found(): string[] {
  return lintRawColours(buildWorkspaceSnapshot({ root, changedFiles: [] })).map(
    (violation) => `${violation.file}:${violation.line} ${violation.specifier}`,
  );
}

const FILE = "modules/demo/browser/src/ui/panel.tsx";

describe("lintRawColours", () => {
  describe("when a style value names a Chakra colour variable", () => {
    /** @scenario "A Chakra colour variable in browser code is a raw colour" */
    it("reports the variable at its line", () => {
      write(
        FILE,
        'export const Panel = () => (\n  <Box borderColor="var(--chakra-colors-gray-500)" />\n);\n',
      );

      expect(found()).toEqual([`${FILE}:2 var(--chakra-colors-gray-500)`]);
    });
  });

  describe("when a style value is a hex or rgb colour", () => {
    /** @scenario "A hex or rgb colour in a style value is a raw colour" */
    it("reports the prop, the css object and the declaration string", () => {
      write(
        FILE,
        [
          'export const A = () => <Box color={ok ? "#ff0000" : "fg"} />;',
          'export const B = () => <Box css={{ _hover: { bg: "rgba(0, 0, 0, 0.5)" } }} />;',
          "export const shadow = `box-shadow: 0 0 2px #abcdef;`;",
        ].join("\n"),
      );

      expect(found()).toEqual([
        `${FILE}:1 #ff0000`,
        `${FILE}:2 rgba(0, 0, 0, 0.5)`,
        `${FILE}:3 #abcdef`,
      ]);
    });
  });

  describe("when a colour-like text is not a style value", () => {
    /** @scenario "A colour outside a style value is not a raw colour" */
    it("reports nothing", () => {
      write(
        FILE,
        [
          "// Recharts defaults the tick text to #666.",
          'export const copy = "Fixed in issue #1234";',
          "export const ink = (r: number, g: number, b: number) => `rgb(${r}, ${g}, ${b})`;",
          'export const A = () => <Box color="fg.muted" />;',
        ].join("\n"),
      );

      expect(found()).toEqual([]);
    });
  });

  describe("when the colour sits outside browser runtime source", () => {
    /** @scenario "Contract, process and test files are not read" */
    it("reports nothing", () => {
      const colour = 'export const A = () => <Box color="#ff0000" />;\n';
      write("modules/demo/contract/src/a.tsx", colour);
      write("modules/demo/process/src/a.tsx", colour);
      write("modules/demo/browser/src/ui/__tests__/a.test.tsx", colour);
      write("modules/demo/browser/src/ui/a.stories.tsx", colour);
      write("packages/design-system/src/a.tsx", colour);

      expect(found()).toEqual([]);
    });
  });

  describe("when a finding is read", () => {
    /** @scenario "Every finding says what to write instead" */
    it("names the semantic token to use and the shrink-only list", () => {
      write(FILE, 'export const A = () => <Box bg="#fff" />;\n');
      const [violation] = lintRawColours(buildWorkspaceSnapshot({ root, changedFiles: [] }));

      expect(violation?.allowed).toContain('color="fg.muted"');
      expect(violation?.allowed).toContain("tests/baselines/raw-colour.json");
    });
  });
});
