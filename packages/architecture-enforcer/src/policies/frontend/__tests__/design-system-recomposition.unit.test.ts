/**
 * Spec: packages/architecture-enforcer/specs/design-system-use.feature.
 * Record: ARCHITECTURE.md §17.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { buildWorkspaceSnapshot } from "../../../workspace/snapshot.ts";
import { lintDesignSystemRecomposition } from "../design-system-recomposition.ts";

let root = "";

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "langwatch-recomposition-"));
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

function lint() {
  return lintDesignSystemRecomposition(buildWorkspaceSnapshot({ root, changedFiles: [] }));
}

function found(): string[] {
  return lint().map((violation) => `${violation.line} ${violation.specifier}`);
}

const FILE = "modules/demo/browser/src/ui/panel.tsx";
const IMPORTS = 'import { Box, chakra, Link, Text } from "@langwatch/design-system/primitives";\n';

describe("lintDesignSystemRecomposition", () => {
  describe("when a Chakra factory element is rendered", () => {
    /** @scenario "A Chakra factory button, input or anchor is a recomposition" */
    it("reports each one with its kind", () => {
      write(
        FILE,
        `${IMPORTS}const Anchor = chakra("a");
export const A = () => <chakra.button onClick={go}>Go</chakra.button>;
export const B = () => <chakra.input value={value} />;
export const C = () => <chakra.span>fine</chakra.span>;
`,
      );

      expect(found()).toEqual(["2 chakra.a", "3 chakra.button", "4 chakra.input"]);
    });
  });

  describe("when a Link is sent to an in-app path", () => {
    /** @scenario "A Link sent to an in-app path is a recomposition" */
    it("reports the literal path and the hand-routed click", () => {
      write(
        FILE,
        `${IMPORTS}export const A = () => <Link href="/settings">Settings</Link>;
export const B = ({ href }: { href: string }) => (
  <Link
    href={href}
    onClick={(event) => {
      event.preventDefault();
      host.navigate(href);
    }}
  >
    Board
  </Link>
);
`,
      );

      expect(found()).toEqual(["2 in-app-link", "4 in-app-link"]);
    });
  });

  describe("when a Link leaves the app", () => {
    /** @scenario "A Link that leaves the app is not a recomposition" */
    it("reports nothing", () => {
      write(
        FILE,
        `${IMPORTS}export const A = () => <Link href="/docs" target="_blank">Docs</Link>;
export const B = () => <Link href={\`/docs/\${page}\`} isExternal>Docs</Link>;
export const C = () => <Link href="https://langwatch.ai">Site</Link>;
`,
      );

      expect(found()).toEqual([]);
    });
  });

  describe("when a red Text prints copy", () => {
    /** @scenario "A red Text printing a form field error is a recomposition" */
    it("reports only the one printing a form field's error", () => {
      write(
        FILE,
        `${IMPORTS}export const A = () => (
  <Text fontSize="xs" color="red.fg">
    {errors.name?.message}
  </Text>
);
export const B = () => <Text color="red.fg">Something went wrong</Text>;
`,
      );

      expect(found()).toEqual(["3 form-error-text"]);
    });
  });

  describe("when a finding is read", () => {
    /** @scenario "Every finding says what to write instead" */
    it("names the component to use and the shrink-only list", () => {
      write(FILE, `${IMPORTS}export const A = () => <Link href="/settings">Settings</Link>;\n`);
      const [violation] = lint();

      expect(violation?.allowed).toContain("@langwatch/browser-host/link");
      expect(violation?.allowed).toContain("tests/baselines/design-system-recomposition.json");
    });
  });
});
