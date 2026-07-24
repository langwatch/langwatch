import { describe, expect, it } from "vitest";
import chalk from "chalk";

import { buildTable, humanRelative } from "../list";

// Force chalk to emit ANSI even in non-TTY (vitest) so the
// "preserves ANSI codes verbatim" assertion is meaningful.
chalk.level = 1;

// eslint-disable-next-line no-control-regex -- intentional: stripping ANSI escape codes from chalk output
const stripAnsi = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, "");

describe("humanRelative", () => {
  describe("when the timestamp is in the past", () => {
    it("returns 'Ns ago' for sub-minute deltas", () => {
      const now = Date.now();
      expect(humanRelative(new Date(now - 5_000), now)).toBe("5s ago");
    });

    it("returns 'Nm ago' for sub-hour deltas", () => {
      const now = Date.now();
      expect(humanRelative(new Date(now - 5 * 60_000), now)).toBe("5m ago");
    });

    it("returns 'Nh ago' for sub-day deltas", () => {
      const now = Date.now();
      expect(humanRelative(new Date(now - 5 * 3600_000), now)).toBe("5h ago");
    });

    it("returns 'Nd ago' for multi-day deltas", () => {
      const now = Date.now();
      expect(humanRelative(new Date(now - 5 * 86400_000), now)).toBe("5d ago");
    });

    it("rounds DOWN at boundaries (59s → '59s ago', 60s → '1m ago')", () => {
      const now = Date.now();
      expect(humanRelative(new Date(now - 59_000), now)).toBe("59s ago");
      expect(humanRelative(new Date(now - 60_000), now)).toBe("1m ago");
    });
  });

  describe("when the timestamp is in the future (clock drift)", () => {
    it("falls back to the ISO string instead of 'in N minutes'", () => {
      const now = Date.now();
      const future = new Date(now + 60_000);
      expect(humanRelative(future, now)).toBe(future.toISOString());
    });
  });
});

describe("buildTable", () => {
  describe("when rows is empty", () => {
    it("returns an empty string (no header without rows)", () => {
      expect(buildTable([])).toBe("");
    });
  });

  describe("when rendering plain (non-ANSI) cells", () => {
    it("pads each cell to the column max + joins rows with \\n", () => {
      const out = buildTable([
        ["NAME", "TYPE"],
        ["abc", "x"],
        ["abcdef", "yy"],
      ]);
      const lines = out.split("\n");
      expect(lines).toHaveLength(3);
      // Column widths: name=6 (abcdef), type=4 (TYPE)
      expect(lines[0]).toBe("NAME    TYPE");
      expect(lines[1]).toBe("abc     x   ");
      expect(lines[2]).toBe("abcdef  yy  ");
    });
  });

  describe("when cells contain ANSI escape codes (chalk colours)", () => {
    it("uses the visible width (post-strip) for column alignment, not the raw length", () => {
      // chalk.green("active") is ~14 raw chars but 6 visible. Without
      // stripping, the second column would be over-padded by ~8 spaces.
      const out = buildTable([
        ["NAME", "STATUS"],
        ["abc", chalk.green("active")],
        ["abcdef", "x"],
      ]);
      const lines = out.split("\n").map(stripAnsi);
      expect(lines[0]).toBe("NAME    STATUS");
      expect(lines[1]).toBe("abc     active");
      expect(lines[2]).toBe("abcdef  x     ");
    });

    it("preserves the ANSI codes verbatim — strip is for measurement only", () => {
      const out = buildTable([
        ["NAME"],
        [chalk.red("err")],
      ]);
      // Raw output should still contain the colour codes; only the
      // padding calculation strips them.
      expect(out).toContain("\x1b[31m");
      expect(out).toContain("\x1b[39m");
    });
  });

  describe("when a row has fewer cells than the header", () => {
    it("treats missing cells as empty (no crash on ragged input)", () => {
      const out = buildTable([
        ["A", "B", "C"],
        ["x"], // ragged
      ]);
      const lines = out.split("\n");
      expect(lines).toHaveLength(2);
      expect(lines[0]).toBe("A  B  C");
      // Second row has only one filled cell; trailing cells are empty
      // strings padded to the column width.
      expect(lines[1]!.startsWith("x")).toBe(true);
    });
  });
});
