/**
 * Unit tests for token-created-snippets.feature — grep-verifiable import invariants.
 *
 * These tests verify structural correctness without rendering React components:
 * shared component paths, no parallel implementations, no extra highlighting libraries,
 * lazy-loading via dynamic().
 */

import fs from "fs";
import path from "path";
import { describe, expect, it } from "vitest";
import { CODE_ASSISTANTS, type CodeAssistant } from "../TokenCreatedDialog";

const LANGWATCH_ROOT = path.resolve(__dirname, "../../../../../");

function readFile(rel: string): string {
  return fs.readFileSync(path.join(LANGWATCH_ROOT, rel), "utf8");
}

const CODE_PREVIEW_PATH =
  "src/features/onboarding/components/sections/observability/CodePreview.tsx";

describe("given the token-created-snippets feature is implemented", () => {
  describe("when checking that CodePreview registers the languages the dialog needs", () => {
    /** @scenario Highlight engine wiring — CodePreview registers the languages the dialog needs */
    it("CodePreview's adapter registers 'ini' for the .env tab", () => {
      expect(readFile(CODE_PREVIEW_PATH)).toContain('"ini"');
    });

    /** @scenario Highlight engine wiring — CodePreview registers the languages the dialog needs */
    it("CodePreview's adapter registers 'shellscript' for the auth-header tabs", () => {
      expect(readFile(CODE_PREVIEW_PATH)).toContain('"shellscript"');
    });

    /** @scenario Highlight engine wiring — CodePreview registers the languages the dialog needs */
    it("CodePreview's adapter registers 'bash' and 'json'", () => {
      const preview = readFile(CODE_PREVIEW_PATH);
      expect(preview).toContain('"bash"');
      expect(preview).toContain('"json"');
    });

    /** @scenario Highlight engine wiring — CodePreview registers the languages the dialog needs */
    it("the dialog declares one concrete language per block, at the call site", () => {
      const dialog = readFile("src/pages/settings/api-keys/TokenCreatedDialog.tsx");
      expect(dialog).toContain('codeLanguage="ini"');
      expect(dialog).toContain('codeLanguage="shellscript"');
      expect(dialog).toContain('codeLanguage="bash"');
    });
  });

  describe("when checking that the amber warning is present in TokenCreatedDialog", () => {
    /** @scenario Amber warning between .env block and Code Assistants section stays */
    it("TokenCreatedDialog contains the 'Copy this token now' amber warning text", () => {
      const dialog = readFile("src/pages/settings/api-keys/TokenCreatedDialog.tsx");
      expect(dialog).toContain("Copy this token now");
    });

    /** @scenario Amber warning between .env block and Code Assistants section stays */
    it("TokenCreatedDialog renders the amber warning with a warning status Alert", () => {
      const dialog = readFile("src/pages/settings/api-keys/TokenCreatedDialog.tsx");
      expect(dialog).toContain('status="warning"');
    });
  });

  describe("when checking that the dialog renders through the shared snippet surface", () => {
    /** @scenario The dialog renders snippets through the same component as the traces empty state */
    it("TokenCreatedDialog imports the shared CodePreview for snippet rendering", () => {
      const dialog = readFile("src/pages/settings/api-keys/TokenCreatedDialog.tsx");
      expect(dialog).toContain("CodePreview");
      expect(dialog).not.toContain("ShikiCommandBox");
    });

    /** @scenario The dialog renders snippets through the same component as the traces empty state */
    it("the dialog-local ShikiCommandBox component is deleted from the codebase", () => {
      expect(
        fs.existsSync(
          path.join(LANGWATCH_ROOT, "src/components/code/ShikiCommandBox.tsx"),
        ),
      ).toBe(false);
    });

    /** @scenario The dialog renders snippets through the same component as the traces empty state */
    it("TokenCreatedDialog does not directly import CodeBlock for snippet rendering", () => {
      const dialog = readFile("src/pages/settings/api-keys/TokenCreatedDialog.tsx");
      // The old CodeBlock.tsx must no longer be imported
      expect(dialog).not.toMatch(/import.*CodeBlock.*from.*['"]\./);
    });

    /** @scenario JSON config block keeps the existing JsonHighlight wiring */
    it("JsonHighlight is still used in TokenCreatedDialog for the config block", () => {
      const dialog = readFile("src/pages/settings/api-keys/TokenCreatedDialog.tsx");
      expect(dialog).toContain("JsonHighlight");
    });
  });

  describe("when checking that one list drives the assistant tabs and config paths", () => {
    /** @scenario One list of coding assistants drives both the tabs and the config paths */
    it("TokenCreatedDialog no longer keeps a separate EDITOR_PATHS list", () => {
      const dialog = readFile("src/pages/settings/api-keys/TokenCreatedDialog.tsx");
      expect(dialog).not.toContain("EDITOR_PATHS");
      expect(dialog).toContain("CODE_ASSISTANTS");
    });

    /** @scenario One list of coding assistants drives both the tabs and the config paths */
    it("renders both the tabs and the config-path chips from CODE_ASSISTANTS", () => {
      const dialog = readFile("src/pages/settings/api-keys/TokenCreatedDialog.tsx");
      // Two map() call sites, both over the same list: the tab strip and the
      // config-path chip row.
      const renders = dialog.match(/CODE_ASSISTANTS[\s\S]{0,40}?\.map\(/g) ?? [];
      expect(renders.length).toBeGreaterThanOrEqual(2);
    });
  });

  describe("when checking what each assistant entry builds", () => {
    // Full expected strings, not substrings. The assistants deliberately
    // differ in where each flag goes — Claude Code puts the project id before
    // the `--` and its key after, Codex puts everything before — and a
    // substring check passes happily while those are wrong. A Gemini entry
    // whose flags sat on the wrong side of the server name shipped and was
    // pulled for exactly that reason (#6654).
    const API_KEY = "sk-lw-real";
    const PROJECT_ID = "project-abc";
    const CLOUD = "https://app.langwatch.ai";
    const SELF_HOSTED = "https://self.host";

    // Both optional flags, independently: a project id and a self-hosted
    // endpoint are unrelated choices, and the case where BOTH are present is
    // the densest line either builder emits — the one where an ordering
    // mistake is most likely and least visible.
    const COMBOS = [
      {
        label: "with a project id, cloud",
        projectId: PROJECT_ID,
        endpoint: CLOUD,
        isSelfHosted: false,
      },
      {
        label: "with a project id, self-hosted",
        projectId: PROJECT_ID,
        endpoint: SELF_HOSTED,
        isSelfHosted: true,
      },
      {
        label: "without a project id, cloud",
        projectId: undefined,
        endpoint: CLOUD,
        isSelfHosted: false,
      },
      {
        label: "without a project id, self-hosted",
        projectId: undefined,
        endpoint: SELF_HOSTED,
        isSelfHosted: true,
      },
    ] as const;

    const EXPECTED = {
      "claude-code": {
        "with a project id, cloud":
          "claude mcp add langwatch --env LANGWATCH_PROJECT_ID=project-abc -- npx -y @langwatch/mcp-server --api-key sk-lw-real",
        "with a project id, self-hosted":
          "claude mcp add langwatch --env LANGWATCH_PROJECT_ID=project-abc -- npx -y @langwatch/mcp-server --api-key sk-lw-real --endpoint https://self.host",
        "without a project id, cloud":
          "claude mcp add langwatch -- npx -y @langwatch/mcp-server --api-key sk-lw-real",
        "without a project id, self-hosted":
          "claude mcp add langwatch -- npx -y @langwatch/mcp-server --api-key sk-lw-real --endpoint https://self.host",
      },
      codex: {
        "with a project id, cloud":
          "codex mcp add langwatch --env LANGWATCH_API_KEY=sk-lw-real --env LANGWATCH_PROJECT_ID=project-abc -- npx -y @langwatch/mcp-server",
        "with a project id, self-hosted":
          "codex mcp add langwatch --env LANGWATCH_API_KEY=sk-lw-real --env LANGWATCH_PROJECT_ID=project-abc --env LANGWATCH_ENDPOINT=https://self.host -- npx -y @langwatch/mcp-server",
        "without a project id, cloud":
          "codex mcp add langwatch --env LANGWATCH_API_KEY=sk-lw-real -- npx -y @langwatch/mcp-server",
        "without a project id, self-hosted":
          "codex mcp add langwatch --env LANGWATCH_API_KEY=sk-lw-real --env LANGWATCH_ENDPOINT=https://self.host -- npx -y @langwatch/mcp-server",
      },
    } as const satisfies Record<string, Record<(typeof COMBOS)[number]["label"], string>>;

    for (const key of Object.keys(EXPECTED) as Array<keyof typeof EXPECTED>) {
      for (const combo of COMBOS) {
        /** @scenario An assistant with an install command shows a terminal snippet */
        it(`builds ${key}'s command exactly, ${combo.label}`, () => {
          const assistant = CODE_ASSISTANTS.find((a) => a.key === key);
          expect(assistant?.buildCommand).toBeDefined();

          const context: Parameters<NonNullable<CodeAssistant["buildCommand"]>>[0] = {
            apiKey: API_KEY,
            projectId: combo.projectId,
            endpoint: combo.endpoint,
            isSelfHosted: combo.isSelfHosted,
          };

          expect(assistant!.buildCommand!(context)).toBe(EXPECTED[key][combo.label]);
        });
      }
    }

    /** @scenario An assistant with an install command shows a terminal snippet */
    it("covers every installer in the registry", () => {
      const withCommand = CODE_ASSISTANTS.filter((a) => a.buildCommand).map((a) => a.key);
      // If someone adds an installer, this fails until its exact commands are
      // pinned above — which is the whole point.
      expect(Object.keys(EXPECTED).sort()).toEqual(withCommand.sort());
    });

    /** @scenario An assistant without an install command points at its config file */
    it("gives every installer-less assistant a config path", () => {
      const configOnly = CODE_ASSISTANTS.filter((assistant) => !assistant.buildCommand);
      expect(configOnly.length).toBeGreaterThan(0);

      for (const assistant of configOnly) {
        expect(assistant.configPath).toBeTruthy();
      }
    });
  });

  describe("when checking that the Shiki engine stays out of the settings page bundle", () => {
    /** @scenario The Shiki engine loads only when a code block renders */
    it("CodePreview loads the engine inside its adapter, not statically", () => {
      // `await import("shiki")` inside load() is what keeps a static import
      // of CodePreview from pulling the engine into the page bundle.
      expect(readFile(CODE_PREVIEW_PATH)).toContain('await import("shiki")');
    });

    /** @scenario The Shiki engine loads only when a code block renders */
    it("TokenCreatedDialog has no value import of the shiki package", () => {
      const dialog = readFile("src/pages/settings/api-keys/TokenCreatedDialog.tsx");
      // Import statements are the invariant — comments may (and do) name
      // shikiAdapter when explaining the pre-existing JsonHighlight chain.
      expect(dialog).not.toMatch(/^import (?!type ).*from "shiki"/m);
      expect(dialog).not.toMatch(/^import .*shikiAdapter/m);
    });

    /** @scenario The Shiki engine loads only when a code block renders */
    it("api-keys/index.tsx does not statically import shikiAdapter", () => {
      const indexPage = readFile("src/pages/settings/api-keys/index.tsx");
      expect(indexPage).not.toContain("shikiAdapter");
    });

    /** @scenario The Shiki engine loads only when a code block renders */
    it("ApiKeysSection.tsx does not statically import shikiAdapter", () => {
      const section = readFile("src/pages/settings/api-keys/ApiKeysSection.tsx");
      expect(section).not.toContain("shikiAdapter");
    });
  });

  describe("when checking that no new syntax-highlighting library is added", () => {
    /** @scenario No new highlighting library is added */
    it("package.json contains only the pre-existing highlighting libraries (positive allowlist)", () => {
      const pkg = readFile("package.json");
      const parsed = JSON.parse(pkg) as {
        dependencies?: Record<string, string>;
        devDependencies?: Record<string, string>;
      };
      const allDepNames = Object.keys({
        ...parsed.dependencies,
        ...parsed.devDependencies,
      });
      // Tight pattern: match common syntax-highlighter package names while
      // excluding unrelated packages that share a substring (e.g. `prisma`,
      // `@prisma/client`, `ra-data-simple-prisma` all contain "prism").
      const highlightLibPattern =
        /^(@?[^/]*shiki[^/]*|prismjs?|prism-react-renderer|highlight\.js|hljs|refractor|lowlight|react-syntax-highlighter)$/i;
      const highlightLibs = allDepNames
        .filter((name) => highlightLibPattern.test(name))
        .sort();
      // Lock in the current set — any new highlighter dep added by a future PR
      // will fail this test until the allowlist is intentionally expanded.
      // Shiki is the app's only highlighter: prism-react-renderer and prismjs
      // were removed once Vite 8's Rolldown bundler stopped preserving the
      // import order their `global.Prism` side-effect registration relied on
      // (RenderCode.tsx renders via the shared Shiki singleton instead).
      expect(highlightLibs).toEqual(["shiki"]);
    });
  });
});
