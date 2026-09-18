/**
 * TypeScript parse seam for static scans: tests missing files and cache-reuse
 * failure modes.
 */

import type { Node } from "typescript/unstable/ast";
import { isCallExpression, isIdentifier } from "typescript/unstable/ast";
import { describe, expect, it } from "vitest";

import { parseSourceText } from "../ts-ast.ts";

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
    /** @scenario "Source text with no file behind it still parses" */
    it("walks the syntax tree of the text it was given", () => {
      const source = parseSourceText({
        fileName: "nowhere/onlyInMemory.ts",
        sourceText: "const x = compute(1); other(x);",
      });

      expect(calledNames({ node: source })).toEqual(["compute", "other"]);
    });
  });

  describe("when a second snippet reuses the first one's name", () => {
    /** @scenario "A name reused with new text parses the new text" */
    it("parses the second text rather than answering from the cache", () => {
      const fileName = "nowhere/reused.ts";
      parseSourceText({ fileName, sourceText: "first();" });
      const second = parseSourceText({ fileName, sourceText: "second();" });

      expect(calledNames({ node: second })).toEqual(["second"]);
    });
  });
});
