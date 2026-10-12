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
        // No longer illegally indented -> compile() would not raise IndentationError.
        expect(firstLine).toBe("class Code(dspy.Module):");
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

  /**
   * The whole design rests on this function agreeing with the Python side, and
   * nothing else pins that: the runner dedents with textwrap.dedent, the server
   * dedents with this. Each expectation below was captured by running
   * `textwrap.dedent` on the input under CPython 3.12.3 — so an edit to either
   * implementation that pulls them apart fails here instead of silently
   * producing two different stored/executed programs.
   *
   * Note for whoever extends this: CPython <= 3.12 normalizes whitespace-only
   * lines via `^[ \t]+$`, so a line of exotic whitespace (a non-breaking space
   * from a browser paste) is treated differently than on 3.13+. Every case here
   * uses ordinary spaces and tabs, where all versions agree.
   */
  describe("given the reference cases captured from CPython's textwrap.dedent", () => {
    const cpythonPairs: [name: string, input: string, expected: string][] = [
      [
        "uniform two-space indent",
        '  class Code:\n      def __call__(self, input):\n          return {"output": input.upper()}\n',
        'class Code:\n    def __call__(self, input):\n        return {"output": input.upper()}\n',
      ],
      [
        "already flush",
        "class Code:\n    def __call__(self, input):\n        return 1\n",
        "class Code:\n    def __call__(self, input):\n        return 1\n",
      ],
      [
        "non-uniform indent is left alone",
        "if True:\n        x = 1\n  y = 2\n",
        "if True:\n        x = 1\n  y = 2\n",
      ],
      [
        "blank line inside an indented block",
        "    a = 1\n\n    b = 2\n",
        "a = 1\n\nb = 2\n",
      ],
      [
        "whitespace-only line inside an indented block",
        "    a = 1\n      \n    b = 2\n",
        "a = 1\n\nb = 2\n",
      ],
      [
        "tabs as the common indent",
        "\tdef f():\n\t\treturn 1\n",
        "def f():\n\treturn 1\n",
      ],
      [
        "mixed tab and space prefixes share no common indent",
        "\ta = 1\n  b = 2\n",
        "\ta = 1\n  b = 2\n",
      ],
      ["trailing newline preserved", "  x = 1\n", "x = 1\n"],
      ["single indented line", "    only = 1", "only = 1"],
      ["empty string", "", ""],
      ["only whitespace lines", "   \n\t\n", "\n\n"],
      ["CRLF line endings", "  a = 1\r\n  b = 2\r\n", "a = 1\r\nb = 2\r\n"],
    ];

    it.each(cpythonPairs)("matches textwrap.dedent for %s", (_n, i, o) => {
      expect(dedentPythonCode(i)).toBe(o);
    });
  });
});
