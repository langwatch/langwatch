/**
 * The token dialog's snippets: the commands it builds and the languages it names.
 *
 * Moved from `platform/app/src/pages/settings/api-keys/__tests__/token-created-snippets.unit.test.ts`.
 * THE ASSISTANT-COMMAND CASES ARE VERBATIM — they drive the exported builders
 * and never read a file, so they travelled unchanged. The rest of that file was
 * a SOURCE-READING GUARD over four platform modules, three of which no longer
 * exist, and it is restated here against behaviour instead:
 *
 *   - "CodePreview's adapter registers ini / shellscript / bash / json" was a
 *     substring match on a file. It is now `isShikiLangReady` over every
 *     language the dialog actually names, resolved through the same alias table
 *     the renderer uses. A new tab whose language is only lazily loadable fails
 *     this; the substring match could not have noticed.
 *   - "the dialog-local ShikiCommandBox is deleted" and "index/ApiKeysSection do
 *     not import shikiAdapter" named files this move deletes. What survives is
 *     the invariant under them: nothing in this package statically imports the
 *     Shiki engine, so a settings page that renders no code block does not pay
 *     for one.
 *   - "package.json contains only the pre-existing highlighting libraries" read
 *     `platform/app/package.json`. It is NARROWED to this package's own
 *     manifest: the family may not bring a second highlighter, and the
 *     application-wide version of that guard dies with the file it lived in.
 *     Recorded rather than silently dropped.
 *
 * Spec: specs/api-keys/token-created-snippets.feature
 */

import { isShikiLangReady, normalizeShikiLang } from "@langwatch/design-system/shiki";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  CODE_ASSISTANTS,
  TOKEN_SNIPPET_LANGUAGES,
  type CodeAssistant,
} from "../token-created-dialog";

const PACKAGE_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "..",
  "..",
);

function readPackageFile(relative: string): string {
  return fs.readFileSync(path.join(PACKAGE_ROOT, relative), "utf8");
}

/** Every TypeScript source in the package, so a guard can walk all of them. */
function collectPackageSources(root: string): string[] {
  const found: string[] = [];
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const full = path.join(root, entry.name);
    if (entry.isDirectory()) {
      found.push(...collectPackageSources(full));
      continue;
    }
    if (entry.name.endsWith(".ts") || entry.name.endsWith(".tsx")) found.push(full);
  }
  return found;
}

describe("given the token-created-snippets feature is implemented", () => {
  describe("when checking that the shared highlighter knows the languages the dialog names", () => {
    /** @scenario Highlight engine wiring — CodePreview registers the languages the dialog needs */
    it.each(TOKEN_SNIPPET_LANGUAGES)(
      "%s resolves to a grammar the shared highlighter has loaded eagerly",
      (language) => {
        expect(isShikiLangReady(normalizeShikiLang(language))).toBe(true);
      },
    );

    /** @scenario Highlight engine wiring — CodePreview registers the languages the dialog needs */
    it("names every language the dialog actually passes to a code block", () => {
      const dialog = readPackageFile("src/ui/sections/token-created-dialog.tsx");
      const passed = [...dialog.matchAll(/codeLanguage="([^"]+)"/g)].map((match) => match[1]!);
      expect(passed.length).toBeGreaterThan(0);
      for (const language of passed) {
        expect(TOKEN_SNIPPET_LANGUAGES).toContain(language);
      }
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
    it("nothing in this package imports the shiki engine directly", () => {
      const sources = collectPackageSources(path.join(PACKAGE_ROOT, "src"));
      expect(sources.length).toBeGreaterThan(20);
      for (const source of sources) {
        // Import statements are the invariant — a comment may name shiki while
        // explaining which adapter the block renders through.
        expect(fs.readFileSync(source, "utf8")).not.toMatch(/^import (?!type ).*from "shiki"/m);
      }
    });
  });

  describe("when checking that no new syntax-highlighting library is added", () => {
    /** @scenario No new highlighting library is added */
    it("this package declares no highlighting library of its own", () => {
      const parsed = JSON.parse(readPackageFile("package.json")) as {
        dependencies?: Record<string, string>;
        devDependencies?: Record<string, string>;
      };
      const declared = Object.keys({ ...parsed.dependencies, ...parsed.devDependencies });
      // Tight pattern: match common syntax-highlighter package names while
      // excluding unrelated packages that share a substring.
      const highlightLibPattern =
        /^(@?[^/]*shiki[^/]*|prismjs?|prism-react-renderer|highlight\.js|hljs|refractor|lowlight|react-syntax-highlighter)$/i;
      // The Design System owns the one highlighter the product has, and this
      // family reaches it through `@langwatch/design-system/shiki`. A second one
      // declared here would be a second Oniguruma engine in the same document.
      expect(declared.filter((name) => highlightLibPattern.test(name))).toEqual([]);
    });
  });
});
