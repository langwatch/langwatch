import { describe, expect, it } from "vitest";
import {
  PROMPT_ANALYTICS,
  PROMPT_EVALUATIONS,
  PROMPT_LEVEL_UP,
  PROMPT_PROMPTS,
  PROMPT_SCENARIOS,
  PROMPT_TRACING,
} from "./code-prompts";

/**
 * Regression suite for langwatch/langwatch#3104.
 *
 * Gemini CLI's chat input runs an `@`-file-reference parser on every pasted
 * string (see google-gemini/gemini-cli `atCommandProcessor.ts`). If any
 * `@`-prefixed run it extracts exceeds the OS filesystem NAME_MAX (255 chars
 * on macOS / Linux), Gemini calls `lstat()` on it and crashes with
 * ENAMETOOLONG. Any LangWatch prompt a user pastes into Gemini must therefore
 * stay within a safe margin below NAME_MAX for *every* `@`-token the parser
 * extracts — not just every whitespace-delimited word.
 *
 * The regex below is copied verbatim from
 * https://github.com/google-gemini/gemini-cli packages/cli/src/ui/hooks/atCommandProcessor.ts
 * (`AT_COMMAND_PATH_REGEX_SOURCE`). The double-quoted-run alternative
 * `"[^"]*"` is the dangerous one: it eats across newlines and drags JSON
 * strings together into one giant pseudo-path.
 */
const GEMINI_AT_COMMAND_PATH_REGEX_SOURCE =
  '(?:(?:"(?:[^"]*)")|(?:\\\\.|[^ \\t\\n\\r,;!?()\\[\\]{}.]|\\.(?!$|[ \\t\\n\\r])))+';
const GEMINI_AT_COMMAND_REGEX = new RegExp(
  `(?<!\\\\)@${GEMINI_AT_COMMAND_PATH_REGEX_SOURCE}`,
  "g",
);

/**
 * Safe upper bound for a single `@`-token in any prompt. NAME_MAX is 255 on
 * macOS/Linux; we leave a generous margin so that prepended workspace roots
 * (e.g. `/Users/someone/very/long/project/path`) and future edits do not
 * push us over.
 */
const MAX_AT_TOKEN_LENGTH = 100;

function longestAtMatch(text: string): { value: string; length: number } {
  let longest = "";
  for (const match of text.matchAll(GEMINI_AT_COMMAND_REGEX)) {
    if (match[0].length > longest.length) {
      longest = match[0];
    }
  }
  return { value: longest, length: longest.length };
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
        it(`extracts no @-token longer than ${MAX_AT_TOKEN_LENGTH} characters`, () => {
          const { value, length } = longestAtMatch(text);
          expect(
            length,
            `${name} contains an @-token of ${length} chars that would crash ` +
              `Gemini CLI with ENAMETOOLONG when lstat'd. Excerpt: ${JSON.stringify(
                value.slice(0, 120),
              )}`,
          ).toBeLessThanOrEqual(MAX_AT_TOKEN_LENGTH);
        });
      });
    },
  );

  describe("given PROMPT_TRACING as the primary regression target", () => {
    describe("when looking for the exact crash pattern", () => {
      it("does not embed @langwatch/mcp-server inside a JSON string literal", () => {
        // The crash in issue #3104 is triggered by the sequence
        //   "@langwatch/mcp-server"
        // inside a JSON block: the closing `"` kicks off Gemini's
        // `"[^"]*"` alternative which eats across newlines through the rest
        // of the JSON. Removing that exact pattern makes the regex match
        // terminate at the next whitespace instead.
        expect(PROMPT_TRACING).not.toContain('"@langwatch/mcp-server"');
      });
    });
  });
});
