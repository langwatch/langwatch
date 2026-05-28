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
  describe("when checking that Shiki languages are registered up-front in shikiAdapter", () => {
    /** @scenario Highlight engine wiring — Shiki singleton with the required languages registered */
    it("shikiAdapter registers 'ini' for the .env tab", () => {
      const adapter = readFile(
        "src/features/traces-v2/components/TraceDrawer/markdownView/shikiAdapter.ts",
      );
      expect(adapter).toContain('"ini"');
    });

    /** @scenario Highlight engine wiring — Shiki singleton with the required languages registered */
    it("shikiAdapter registers 'bash' for terminal commands", () => {
      const adapter = readFile(
        "src/features/traces-v2/components/TraceDrawer/markdownView/shikiAdapter.ts",
      );
      expect(adapter).toContain('"bash"');
    });

    /** @scenario Highlight engine wiring — Shiki singleton with the required languages registered */
    it("shikiAdapter registers 'json' for the config block", () => {
      const adapter = readFile(
        "src/features/traces-v2/components/TraceDrawer/markdownView/shikiAdapter.ts",
      );
      expect(adapter).toContain('"json"');
    });
  });

  describe("when checking that TokenCreatedDialog uses the correct language per tab", () => {
    /** @scenario .env tab renders as a highlighted ini command box */
    it("TokenCreatedDialog passes lang=\"ini\" for the .env tab", () => {
      const dialog = readFile(
        "src/pages/settings/api-keys/TokenCreatedDialog.tsx",
      );
      expect(dialog).toContain('lang="ini"');
    });

    /** @scenario Bearer tab renders as a highlighted shell command box */
    /** @scenario Basic Auth tab renders as a highlighted shell command box */
    it("TokenCreatedDialog passes lang=\"shellscript\" for Bearer and Basic Auth tabs", () => {
      const dialog = readFile(
        "src/pages/settings/api-keys/TokenCreatedDialog.tsx",
      );
      expect(dialog).toContain('lang="shellscript"');
    });

    /** @scenario Claude Code tab shows a PostHog-style terminal command snippet */
    /** @scenario Codex tab shows a PostHog-style terminal command snippet */
    it("TokenCreatedDialog passes lang=\"bash\" for Claude Code and Codex terminal commands", () => {
      const dialog = readFile(
        "src/pages/settings/api-keys/TokenCreatedDialog.tsx",
      );
      // bash language is used for Claude Code and Codex command snippets
      expect(dialog).toContain('lang="bash"');
    });
  });

  describe("when checking that the amber warning is present in TokenCreatedDialog", () => {
    /** @scenario Amber warning between .env block and Code Assistants section stays */
    it("TokenCreatedDialog contains the 'Copy this token now' amber warning text", () => {
      const dialog = readFile(
        "src/pages/settings/api-keys/TokenCreatedDialog.tsx",
      );
      expect(dialog).toContain("Copy this token now");
    });

    /** @scenario Amber warning between .env block and Code Assistants section stays */
    it("TokenCreatedDialog renders the amber warning with a warning status Alert", () => {
      const dialog = readFile(
        "src/pages/settings/api-keys/TokenCreatedDialog.tsx",
      );
      expect(dialog).toContain('status="warning"');
    });
  });

  describe("when checking that a single shared command-box replaces CodeBlock and QuickCommand", () => {
    /** @scenario A single shared command-box component replaces CodeBlock and QuickCommand inside TokenCreatedDialog */
    it("TokenCreatedDialog imports one shared command-box component for snippet rendering", () => {
      const dialog = readFile(
        "src/pages/settings/api-keys/TokenCreatedDialog.tsx",
      );
      // Must import ShikiCommandBox (or equivalent single component)
      expect(dialog).toContain("ShikiCommandBox");
    });

    /** @scenario A single shared command-box component replaces CodeBlock and QuickCommand inside TokenCreatedDialog */
    it("TokenCreatedDialog does not directly import CodeBlock for snippet rendering", () => {
      const dialog = readFile(
        "src/pages/settings/api-keys/TokenCreatedDialog.tsx",
      );
      // The old CodeBlock.tsx must no longer be imported
      expect(dialog).not.toMatch(/import.*CodeBlock.*from.*['"]\./);
    });

    /** @scenario A single shared command-box component replaces CodeBlock and QuickCommand inside TokenCreatedDialog */
    it("TokenCreatedDialog does not directly define or import QuickCommand for snippet rendering", () => {
      const dialog = readFile(
        "src/pages/settings/api-keys/TokenCreatedDialog.tsx",
      );
      // QuickCommand must not be defined inline in the dialog
      expect(dialog).not.toContain("function QuickCommand(");
    });

    /** @scenario A single shared command-box component replaces CodeBlock and QuickCommand inside TokenCreatedDialog */
    it("ShikiCommandBox does not export accentCredentialSegments (decoration handled by Shiki grammar)", () => {
      const commandBox = readFile(
        "src/components/code/ShikiCommandBox.tsx",
      );
      // Visual distinction is achieved by Shiki's bash tokenization, not a regex pass
      expect(commandBox).not.toContain("function accentCredentialSegments(");
      expect(commandBox).not.toContain("CREDENTIAL_RE");
    });

    /** @scenario JSON config block keeps the existing JsonHighlight wiring */
    it("JsonHighlight is still used in TokenCreatedDialog for the config block", () => {
      const dialog = readFile(
        "src/pages/settings/api-keys/TokenCreatedDialog.tsx",
      );
      expect(dialog).toContain("JsonHighlight");
    });
  });

  describe("when checking that ShikiCommandBox is lazy-loaded via dynamic()", () => {
    /** @scenario TokenCreatedDialog lazy-loads the Shiki-backed command box on dialog open */
    it("TokenCreatedDialog imports ShikiCommandBox via dynamic() (ssr:false)", () => {
      const dialog = readFile(
        "src/pages/settings/api-keys/TokenCreatedDialog.tsx",
      );
      // Must use dynamic() with ssr: false for the command box
      expect(dialog).toMatch(/dynamic\s*\(/);
      expect(dialog).toContain("ssr: false");
    });

    /** @scenario TokenCreatedDialog lazy-loads the Shiki-backed command box on dialog open */
    it("api-keys/index.tsx does not statically import shikiAdapter", () => {
      const indexPage = readFile("src/pages/settings/api-keys/index.tsx");
      expect(indexPage).not.toContain("shikiAdapter");
    });

    /** @scenario TokenCreatedDialog lazy-loads the Shiki-backed command box on dialog open */
    it("ApiKeysSection.tsx does not statically import shikiAdapter", () => {
      const section = readFile("src/pages/settings/api-keys/ApiKeysSection.tsx");
      expect(section).not.toContain("shikiAdapter");
    });
  });

  describe("when checking that no new syntax-highlighting library is added", () => {
    /** @scenario No new highlighting library is added */
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
