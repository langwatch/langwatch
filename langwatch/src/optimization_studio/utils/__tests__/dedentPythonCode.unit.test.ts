/**
 * Unit tests for dedentPythonCode — the TS twin of Python's textwrap.dedent.
 * Pins issue #3013: a code-agent block pasted into Monaco can inherit a uniform
 * leading indent on every line, which later crashes the runner's compile() with
 * IndentationError. Dedenting restores the canonical flush form.
 */
import { describe, expect, it } from "vitest";

import { dedentPythonCode } from "../dedentPythonCode";

describe("dedentPythonCode", () => {
  describe("given a uniformly indented dspy class block", () => {
    describe("when every line carries the same leading indent", () => {
      it("dedents the block to flush so the class starts at column 0", () => {
        const code =
          "  class Code(dspy.Module):\n" +
          "      def forward(self, **inputs):\n" +
          '          return {"output": inputs}\n';
        const result = dedentPythonCode(code);
        const firstLine = result.split("\n")[0]!;
        expect(firstLine.startsWith("class Code(dspy.Module):")).toBe(true);
        // No longer illegally indented -> compile() would not raise IndentationError.
        expect(result).not.toMatch(/^\s+class/);
      });
    });
  });

  describe("given already-flush code", () => {
    describe("when there is no common leading indent", () => {
      it("returns the code unchanged (round-trip identity)", () => {
        const code =
          "class Code:\n" +
          "    def __call__(self, x):\n" +
          "        return {'doubled': x * 2}\n";
        expect(dedentPythonCode(code)).toBe(code);
      });
    });
  });

  describe("given a 4-space indented class with a blank line in the middle", () => {
    describe("when computing the common indent", () => {
      it("dedents to flush and preserves the blank line as empty", () => {
        const code =
          "    class Code:\n" +
          "        def __call__(self, x):\n" +
          "\n" +
          "            return {'x': x}\n";
        const result = dedentPythonCode(code);
        const lines = result.split("\n");
        expect(lines[0]).toBe("class Code:");
        expect(lines[1]).toBe("    def __call__(self, x):");
        // Whitespace-only line is ignored for the common-indent calc and stays empty.
        expect(lines[2]).toBe("");
        expect(lines[3]).toBe("        return {'x': x}");
      });
    });
  });

  describe("given a uniformly indented block with a whitespace-only line", () => {
    describe("when the blank line has fewer spaces than the common indent", () => {
      it("collapses the whitespace-only line to empty (textwrap.dedent parity)", () => {
        const code = "        a\n    \n        b\n";
        // common indent across non-blank lines is 8 spaces; the middle line
        // has only 4 spaces of whitespace and must be emptied, not left with residual.
        expect(dedentPythonCode(code)).toBe("a\n\nb\n");
      });
    });
  });

  describe("given flush code (no common indent) with a whitespace-only line", () => {
    describe("when a line carries only spaces", () => {
      it("collapses the whitespace-only line to empty (textwrap.dedent parity)", () => {
        // common indent is "" because the first line is already at column 0;
        // the whitespace-only line must still be emptied to match textwrap.dedent.
        expect(dedentPythonCode("x\n   \n")).toBe("x\n\n");
      });
    });
  });

  describe("given a mixed-depth nested body", () => {
    describe("when the whole block is uniformly over-indented", () => {
      it("keeps relative indentation so the method stays nested under the class", () => {
        const code =
          "  class Code:\n" +
          "      def __call__(self, x):\n" +
          "          return {'x': x}\n";
        const result = dedentPythonCode(code);
        const lines = result.split("\n");
        expect(lines[0]).toBe("class Code:");
        // method still indented relative to the class (4 spaces remain after stripping 2).
        expect(lines[1]).toBe("    def __call__(self, x):");
        expect(lines[2]).toBe("        return {'x': x}");
      });
    });
  });

  describe("given trivial inputs", () => {
    describe("when the string is empty", () => {
      it("returns the empty string unchanged", () => {
        expect(dedentPythonCode("")).toBe("");
      });
    });

    describe("when there is a single already-flush line", () => {
      it("returns the line unchanged", () => {
        expect(dedentPythonCode("x = 1")).toBe("x = 1");
      });
    });
  });
});
