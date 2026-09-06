/**
 * The parse seam every static scan sits on.
 *
 * TypeScript 7 parses in the Go binary, not in this process, so "parse this
 * string" became "serve this string to a compiler session through a virtual
 * filesystem". The two things that can silently go wrong with that are covered
 * here: text with no file behind it failing to load at all, and — the quieter
 * one — a name reused with new text being answered from the session's cache,
 * which would make a scan judge every snippet by the first one it saw.
 *
 * Spec: specs/setup/typescript-7.feature
 */

import type { Node } from "typescript/unstable/ast";
import { isCallExpression, isIdentifier } from "typescript/unstable/ast";
import { describe, expect, it } from "vitest";
import { parseSourceText } from "../tsAst";

/** Every identifier called as a function, so a walk has something to find. */
function calledNames({ node }: { node: Node }): string[] {
  const names: string[] = [];
  const visit = (current: Node): void => {
    if (isCallExpression(current) && isIdentifier(current.expression)) {
      names.push(current.expression.text);
    }
    current.forEachChild(visit);
  };
  visit(node);
  return names;
}

describe("given source text that is not on disk", () => {
  describe("when it is parsed", () => {
    // @scenario "Source text with no file behind it still parses"
    it("walks the syntax tree of the text it was given", () => {
      const source = parseSourceText({
        fileName: "nowhere/onlyInMemory.ts",
        sourceText: "const x = compute(1); other(x);",
      });

      expect(calledNames({ node: source })).toEqual(["compute", "other"]);
    });
  });

  describe("when a second snippet reuses the first one's name", () => {
    // @scenario "A name reused with new text parses the new text"
    it("parses the second text rather than answering from the cache", () => {
      const fileName = "nowhere/reused.ts";
      parseSourceText({ fileName, sourceText: "first();" });
      const second = parseSourceText({ fileName, sourceText: "second();" });

      expect(calledNames({ node: second })).toEqual(["second"]);
    });
  });
});
