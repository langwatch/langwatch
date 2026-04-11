import { lstatSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  PROMPT_ANALYTICS,
  PROMPT_EVALUATIONS,
  PROMPT_LEVEL_UP,
  PROMPT_PROMPTS,
  PROMPT_SCENARIOS,
  PROMPT_TRACING,
} from "./code-prompts";
import { buildMcpJson } from "./shared/build-mcp-config";

/**
 * Regression suite for langwatch/langwatch#3104.
 *
 * Gemini CLI's chat-input parser extracts `@`-prefixed runs from pasted text
 * and calls `fs.lstatSync()` on each one (see google-gemini/gemini-cli
 * packages/cli/src/ui/hooks/atCommandProcessor.ts). If the tail path-component
 * of the extracted run exceeds the OS filesystem NAME_MAX (255 on macOS /
 * Linux), lstat throws `ENAMETOOLONG` and the Gemini process dies with an
 * unhandled rejection. Any LangWatch content a user might paste into Gemini
 * must therefore extract cleanly — not just as a short whole token, but as a
 * short longest-component after splitting on `/`.
 *
 * The regex below is copied verbatim from Gemini's
 * `AT_COMMAND_PATH_REGEX_SOURCE`. Its `"[^"]*"` alternative is the bug: it
 * matches across newlines, so a `"@langwatch/mcp-server"` sequence embedded in
 * a JSON block drags the rest of the block into a single match.
 */
const GEMINI_AT_COMMAND_PATH_REGEX_SOURCE = String.raw`(?:(?:"(?:[^"]*)")|(?:\\.|[^ \t\n\r,;!?()\[\]{}.]|\.(?!$|[ \t\n\r])))+`;
const GEMINI_AT_COMMAND_REGEX = new RegExp(
  String.raw`(?<!\\)@` + GEMINI_AT_COMMAND_PATH_REGEX_SOURCE,
  "g",
);

/**
 * macOS and Linux cap a single filesystem path component at NAME_MAX = 255
 * bytes. Observed longest component for realistic content today: 121 bytes
 * (cloud) and 160 bytes (self-hosted with the longest LANGWATCH_API_KEY
 * format LangWatch issues — fixed at 54 bytes, see apiKeyGenerator.ts). A
 * 32-byte safety margin below NAME_MAX leaves headroom for future edits
 * while still catching any regression that reintroduces the issue-#3104
 * crash pattern (where the longest component was 2179 bytes).
 */
const NAME_MAX = 255;
const SAFETY_MARGIN = 32;
const MAX_COMPONENT_LENGTH = NAME_MAX - SAFETY_MARGIN;

interface AtTokenProbe {
  match: string;
  longestComponent: string;
}

function longestAtTokenComponent(text: string): AtTokenProbe {
  let result: AtTokenProbe = { match: "", longestComponent: "" };
  for (const match of text.matchAll(GEMINI_AT_COMMAND_REGEX)) {
    for (const component of match[0].split("/")) {
      if (component.length > result.longestComponent.length) {
        result = { match: match[0], longestComponent: component };
      }
    }
  }
  return result;
}

describe("code-prompts Gemini CLI compatibility (issue #3104)", () => {
  const prompts: Array<{ name: string; text: string }> = [
    { name: "PROMPT_TRACING", text: PROMPT_TRACING },
    { name: "PROMPT_EVALUATIONS", text: PROMPT_EVALUATIONS },
    { name: "PROMPT_SCENARIOS", text: PROMPT_SCENARIOS },
    { name: "PROMPT_PROMPTS", text: PROMPT_PROMPTS },
    { name: "PROMPT_ANALYTICS", text: PROMPT_ANALYTICS },
    { name: "PROMPT_LEVEL_UP", text: PROMPT_LEVEL_UP },
  ];

  describe.each(prompts)(
    "given $name pasted into Gemini CLI",
    ({ name, text }) => {
      describe("when Gemini's atCommandProcessor scans the prompt", () => {
        it(`extracts no path component longer than ${MAX_COMPONENT_LENGTH} bytes`, () => {
          const { match, longestComponent } = longestAtTokenComponent(text);
          expect(
            longestComponent.length,
            `${name} would have Gemini CLI lstat a ${longestComponent.length}-byte ` +
              `component (NAME_MAX=${NAME_MAX}). Full match excerpt: ` +
              JSON.stringify(match.slice(0, 120)),
          ).toBeLessThanOrEqual(MAX_COMPONENT_LENGTH);
        });

        it("does not embed @langwatch/mcp-server inside a JSON string literal", () => {
          // The crash trigger in issue #3104 is the sequence
          //   "@langwatch/mcp-server"
          // inside a JSON block: the closing `"` kicks off Gemini's
          // `"[^"]*"` alternative, which eats across newlines through the
          // rest of the JSON. Forbidding the exact pattern makes the regex
          // match terminate at the next whitespace instead.
          expect(text).not.toContain('"@langwatch/mcp-server"');
        });
      });
    },
  );

  describe("given PROMPT_TRACING as the primary regression target", () => {
    describe("when Node.js lstat'es the worst extracted @-token", () => {
      it("does not throw ENAMETOOLONG", () => {
        // Execute the crashing code path directly: pull the longest @-token
        // Gemini would extract, prepend an ephemeral workspace root, and
        // call fs.lstatSync exactly as Gemini's resolveToRealPath does.
        // Pre-fix, this threw ENAMETOOLONG. Post-fix, it throws ENOENT (or
        // succeeds, which is fine — we only care that NAME_MAX is not hit).
        const { match } = longestAtTokenComponent(PROMPT_TRACING);
        const fakeWorkspace = mkdtempSync(join(tmpdir(), "gemini-regression-"));
        const crashingPath = join(fakeWorkspace, match);
        try {
          lstatSync(crashingPath);
        } catch (error) {
          expect(
            (error as NodeJS.ErrnoException).code,
            `lstat on the longest @-token from PROMPT_TRACING raised ` +
              `${(error as NodeJS.ErrnoException).code}; ENAMETOOLONG means ` +
              `Gemini CLI would crash. Match: ${JSON.stringify(match.slice(0, 120))}`,
          ).not.toBe("ENAMETOOLONG");
        }
      });
    });
  });
});

describe("buildMcpJson Gemini CLI compatibility (issue #3104)", () => {
  // LangWatch API keys have a fixed format: `sk-lw-` + 48 alphanumeric
  // characters = 54 bytes total (see server/utils/apiKeyGenerator.ts).
  // The MCP config JSON is also pasteable via the onboarding "Copy Config"
  // button, so it must extract cleanly under Gemini's regex too. The `/`
  // in the scoped package name `@langwatch/mcp-server` naturally splits
  // the match into shorter components, keeping each one well below
  // NAME_MAX in practice — this test locks that invariant in.
  const REALISTIC_API_KEY = "sk-lw-" + "a".repeat(48);

  describe("given a cloud config with a realistic API key", () => {
    it(`extracts no path component longer than ${MAX_COMPONENT_LENGTH} bytes`, () => {
      const json = buildMcpJson({
        apiKey: REALISTIC_API_KEY,
        endpoint: undefined,
      });
      const { longestComponent } = longestAtTokenComponent(json);
      expect(longestComponent.length).toBeLessThanOrEqual(MAX_COMPONENT_LENGTH);
    });
  });

  describe("given a self-hosted config with a long enterprise endpoint", () => {
    it(`extracts no path component longer than ${MAX_COMPONENT_LENGTH} bytes`, () => {
      const json = buildMcpJson({
        apiKey: REALISTIC_API_KEY,
        endpoint:
          "https://langwatch.extremely-long-enterprise-subdomain.internal.global.example.com",
      });
      const { longestComponent } = longestAtTokenComponent(json);
      expect(longestComponent.length).toBeLessThanOrEqual(MAX_COMPONENT_LENGTH);
    });
  });
});
