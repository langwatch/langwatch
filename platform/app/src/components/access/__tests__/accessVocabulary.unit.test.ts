import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { Node } from "typescript/unstable/ast";
import {
  isJsxText,
  isNoSubstitutionTemplateLiteral,
  isStringLiteral,
  isTemplateLiteralToken,
} from "typescript/unstable/ast";
import { describe, expect, it } from "vitest";
import { parseSourceTexts } from "~/test-utils/tsAst";

/**
 * The access cluster says what the industry says, not what the engine says.
 *
 * Underneath, a role is BOUND to a PRINCIPAL at a SCOPE, and ADR-092 goes on
 * calling it that: renaming a table for the sake of a screen is how a codebase
 * ends up with two vocabularies for one idea. On screen it is a ROLE
 * ASSIGNMENT, assigned to a member or a group, ON the organization, a team or
 * a project — because that is what every identity product a customer has used
 * calls it, and a page that invents a word costs its reader a guess.
 *
 * This reads the ACTUAL WORDS: every string literal and every piece of JSX
 * text in the surfaces below, taken from the parsed source so an identifier
 * called `bindingKey` and a sentence saying "binding" cannot be confused for
 * one another. A guard that grepped would have to choose between missing the
 * sentence and failing on the identifier.
 */
const ACCESS_COMPONENTS = join(__dirname, "..");
const SETTINGS_PAGES = join(__dirname, "..", "..", "..", "pages", "settings");

/** Words that belong to the engine and to nobody reading a screen. */
const ENGINE_WORDS = [/\bbindings?\b/i, /\bprincipals?\b/i];

/**
 * Where a word may still appear: an internal identifier is not copy, and a
 * `data-testid` is not read by a customer either. Both are excluded by taking
 * only literals and JSX text below; this list is for the literals that ARE
 * identifiers — test ids, query keys and the like.
 */
const NOT_COPY = /^[a-z0-9-]+$/;

function surfaceFiles(): { fileName: string; sourceText: string }[] {
  const componentFiles = readdirSync(ACCESS_COMPONENTS)
    .filter((name) => name.endsWith(".tsx"))
    .map((name) => join(ACCESS_COMPONENTS, name));
  const pageFiles = [
    "members.tsx",
    "roles.tsx",
    "groups.tsx",
    "access.tsx",
    "scim.tsx",
  ].map((name) => join(SETTINGS_PAGES, name));

  return [...componentFiles, ...pageFiles].map((path) => ({
    fileName: path,
    sourceText: readFileSync(path, "utf-8"),
  }));
}

/**
 * Every word a reader could see: string literals and JSX text, minus the
 * comments (which are for us) and minus the identifiers (which are code).
 */
function readableStrings(sourceText: string, fileName: string): string[] {
  const [parsed] = parseSourceTexts({
    sources: [{ fileName, sourceText }],
  });
  if (!parsed) throw new Error(`${fileName} did not parse`);

  const found: string[] = [];
  const visit = (node: Node) => {
    if (
      isStringLiteral(node) ||
      isJsxText(node) ||
      isNoSubstitutionTemplateLiteral(node) ||
      isTemplateLiteralToken(node)
    ) {
      found.push(node.text);
    }
    node.forEachChild(visit);
  };
  parsed.source.forEachChild(visit);

  return found
    .map((text) => text.trim())
    .filter((text) => text.length > 0 && !NOT_COPY.test(text));
}

describe("the words the access cluster shows a customer", () => {
  const files = surfaceFiles();

  describe("when the scan itself is checked", () => {
    // A guard that reads source and finds nothing is indistinguishable from a
    // guard that reads nothing, so it is shown a file it must reject.
    it("catches the engine's vocabulary in copy and ignores it in code", () => {
      const planted = `
        const bindingKey = "x";
        export function Panel() {
          return <div aria-label="Remove binding"><span>Role Bindings</span></div>;
        }
      `;
      const readable = readableStrings(planted, "planted.tsx");

      expect(
        readable.filter((text) => ENGINE_WORDS.some((word) => word.test(text))),
      ).toEqual(["Remove binding", "Role Bindings"]);
      // The identifier is code and is never read as copy.
      expect(readable).not.toContain("bindingKey");
    });
  });

  describe("when a surface renders", () => {
    /** @scenario The screen says role assignment, never binding */
    it.each(
      files.map((file) => file.fileName),
    )("%s never shows the engine's own vocabulary", (fileName) => {
      const file = files.find((candidate) => candidate.fileName === fileName);
      const offending = readableStrings(
        file?.sourceText ?? "",
        fileName,
      ).filter((text) => ENGINE_WORDS.some((word) => word.test(text)));

      expect(offending).toEqual([]);
    });
  });
});
