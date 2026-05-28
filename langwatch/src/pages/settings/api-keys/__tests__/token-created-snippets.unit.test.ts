/**
 * Unit tests for token-created-snippets.feature — grep-verifiable import invariants.
 *
 * These tests verify structural correctness without rendering React components:
 * shared component paths, no parallel implementations, no extra highlighting libraries,
 * lazy-loading via dynamic().
 */

import { describe, expect, it } from "vitest";
import fs from "fs";
import path from "path";

const LANGWATCH_ROOT = path.resolve(__dirname, "../../../../../");

function readFile(rel: string): string {
  return fs.readFileSync(path.join(LANGWATCH_ROOT, rel), "utf8");
}

describe("given the token-created-snippets feature is implemented", () => {
  describe("when checking that a single shared command-box replaces CodeBlock and QuickCommand", () => {
    it("TokenCreatedDialog imports one shared command-box component for snippet rendering", () => {
      const dialog = readFile(
        "src/pages/settings/api-keys/TokenCreatedDialog.tsx",
      );
      // Must import ShikiCommandBox (or equivalent single component)
      expect(dialog).toContain("ShikiCommandBox");
    });

    it("TokenCreatedDialog does not directly import CodeBlock for snippet rendering", () => {
      const dialog = readFile(
        "src/pages/settings/api-keys/TokenCreatedDialog.tsx",
      );
      // The old CodeBlock.tsx must no longer be imported
      expect(dialog).not.toMatch(/import.*CodeBlock.*from.*['"]\./);
    });

    it("TokenCreatedDialog does not directly define or import QuickCommand for snippet rendering", () => {
      const dialog = readFile(
        "src/pages/settings/api-keys/TokenCreatedDialog.tsx",
      );
      // QuickCommand must not be defined inline in the dialog
      expect(dialog).not.toContain("function QuickCommand(");
    });

    it("ShikiCommandBox does not export accentCredentialSegments (decoration handled by Shiki grammar)", () => {
      const commandBox = readFile(
        "src/components/code/ShikiCommandBox.tsx",
      );
      // Visual distinction is achieved by Shiki's bash tokenization, not a regex pass
      expect(commandBox).not.toContain("function accentCredentialSegments(");
      expect(commandBox).not.toContain("CREDENTIAL_RE");
    });

    it("JsonHighlight is still used in TokenCreatedDialog for the config block", () => {
      const dialog = readFile(
        "src/pages/settings/api-keys/TokenCreatedDialog.tsx",
      );
      expect(dialog).toContain("JsonHighlight");
    });
  });

  describe("when checking that ShikiCommandBox is lazy-loaded via dynamic()", () => {
    it("TokenCreatedDialog imports ShikiCommandBox via dynamic() (ssr:false)", () => {
      const dialog = readFile(
        "src/pages/settings/api-keys/TokenCreatedDialog.tsx",
      );
      // Must use dynamic() with ssr: false for the command box
      expect(dialog).toMatch(/dynamic\s*\(/);
      expect(dialog).toContain("ssr: false");
    });

    it("api-keys/index.tsx does not statically import shikiAdapter", () => {
      const indexPage = readFile("src/pages/settings/api-keys/index.tsx");
      expect(indexPage).not.toContain("shikiAdapter");
    });

    it("ApiKeysSection.tsx does not statically import shikiAdapter", () => {
      const section = readFile("src/pages/settings/api-keys/ApiKeysSection.tsx");
      expect(section).not.toContain("shikiAdapter");
    });
  });

  describe("when checking that no new syntax-highlighting library is added", () => {
    it("package.json does not contain a new highlighting library", () => {
      const pkg = readFile("package.json");
      const parsed = JSON.parse(pkg) as {
        dependencies?: Record<string, string>;
        devDependencies?: Record<string, string>;
      };
      const allDeps = {
        ...parsed.dependencies,
        ...parsed.devDependencies,
      };
      // Shiki is allowed (already present). prismjs + prism-react-renderer are pre-existing
      // legacy deps used elsewhere — out of scope for this PR. The list below names libraries
      // that were NOT in package.json before this work and must NOT be added by it.
      const forbidden = [
        "highlight.js",
        "highlightjs",
        "refractor",
        "lowlight",
        "react-syntax-highlighter",
        "react-highlight",
      ];
      for (const lib of forbidden) {
        expect(Object.keys(allDeps)).not.toContain(lib);
      }
    });
  });
});
