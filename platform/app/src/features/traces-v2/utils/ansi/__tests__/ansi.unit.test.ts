import { describe, expect, it } from "vitest";
import {
  type AnsiLine,
  hasAnsi,
  parseAnsi,
  stripAnsi,
  xterm256ToHex,
} from "../ansi";

/** Flatten a parsed result to plain text, joining lines with \n. */
function textOf(lines: AnsiLine[]): string {
  return lines.map((l) => l.segments.map((s) => s.text).join("")).join("\n");
}

/** All segments across all lines, for style assertions. */
function segmentsOf(lines: AnsiLine[]) {
  return lines.flatMap((l) => l.segments);
}

describe("parseAnsi", () => {
  describe("given plain text with no escape codes", () => {
    it("passes the text through as a single unstyled segment", () => {
      const lines = parseAnsi("hello world");
      expect(lines).toHaveLength(1);
      expect(lines[0]!.segments).toEqual([{ text: "hello world", style: {} }]);
    });

    it("splits on newlines into separate lines", () => {
      const lines = parseAnsi("alpha\nbeta\ngamma");
      expect(lines).toHaveLength(3);
      expect(textOf(lines)).toBe("alpha\nbeta\ngamma");
    });

    it("returns a single empty line for empty input", () => {
      const lines = parseAnsi("");
      expect(lines).toEqual([{ segments: [] }]);
    });
  });

  describe("given basic SGR colour codes", () => {
    it("applies a named foreground colour", () => {
      const lines = parseAnsi("\x1b[31mred\x1b[0m");
      const [seg] = segmentsOf(lines);
      expect(seg).toEqual({
        text: "red",
        style: { fg: { kind: "named", name: "red" } },
      });
    });

    it("applies a named background colour", () => {
      const [seg] = segmentsOf(parseAnsi("\x1b[42mx\x1b[0m"));
      expect(seg!.style.bg).toEqual({ kind: "named", name: "green" });
    });

    it("maps 90-97 to bright foreground colours", () => {
      const [seg] = segmentsOf(parseAnsi("\x1b[92mx"));
      expect(seg!.style.fg).toEqual({ kind: "named", name: "brightGreen" });
    });

    it("resets styling back to plain after \\x1b[0m", () => {
      const lines = parseAnsi("\x1b[31mred\x1b[0mplain");
      const segs = segmentsOf(lines);
      expect(segs).toHaveLength(2);
      expect(segs[0]!.style.fg).toEqual({ kind: "named", name: "red" });
      expect(segs[1]!.style).toEqual({});
    });

    it("treats a bare \\x1b[m as a full reset", () => {
      const lines = parseAnsi("\x1b[1mbold\x1b[mplain");
      const segs = segmentsOf(lines);
      expect(segs[0]!.style.bold).toBe(true);
      expect(segs[1]!.style).toEqual({});
    });
  });

  describe("given text attributes", () => {
    it("tracks bold, italic, underline, and strikethrough", () => {
      const [seg] = segmentsOf(parseAnsi("\x1b[1;3;4;9mx"));
      expect(seg!.style).toMatchObject({
        bold: true,
        italic: true,
        underline: true,
        strikethrough: true,
      });
    });

    it("clears bold+dim on 22 but keeps other attributes", () => {
      const lines = parseAnsi("\x1b[1;4mA\x1b[22mB");
      const segs = segmentsOf(lines);
      expect(segs[0]!.style).toMatchObject({ bold: true, underline: true });
      expect(segs[1]!.style.bold).toBeUndefined();
      expect(segs[1]!.style.underline).toBe(true);
    });

    it("records inverse video for SGR 7", () => {
      const [seg] = segmentsOf(parseAnsi("\x1b[7mx"));
      expect(seg!.style.inverse).toBe(true);
    });
  });

  describe("given 256-colour codes", () => {
    it("maps a low index (0-15) to a theme-aware named colour", () => {
      const [seg] = segmentsOf(parseAnsi("\x1b[38;5;1mx"));
      expect(seg!.style.fg).toEqual({ kind: "named", name: "red" });
    });

    it("maps a cube index to an rgb hex", () => {
      const [seg] = segmentsOf(parseAnsi("\x1b[38;5;196mx"));
      expect(seg!.style.fg).toEqual({ kind: "rgb", hex: "#ff0000" });
    });

    it("maps a 256 background index", () => {
      const [seg] = segmentsOf(parseAnsi("\x1b[48;5;21mx"));
      expect(seg!.style.bg).toEqual({ kind: "rgb", hex: "#0000ff" });
    });
  });

  describe("given a truecolor code", () => {
    it("maps 38;2;r;g;b to an rgb hex", () => {
      const [seg] = segmentsOf(parseAnsi("\x1b[38;2;10;20;30mx"));
      expect(seg!.style.fg).toEqual({ kind: "rgb", hex: "#0a141e" });
    });
  });

  describe("given nested styles", () => {
    it("carries an outer attribute into an inner colour change", () => {
      const lines = parseAnsi("\x1b[1m\x1b[31mA\x1b[0mB");
      const segs = segmentsOf(lines);
      expect(segs[0]!.style).toMatchObject({
        bold: true,
        fg: { kind: "named", name: "red" },
      });
      expect(segs[1]!.style).toEqual({});
    });
  });

  describe("given non-SGR control sequences", () => {
    it("drops a cursor/erase CSI sequence but keeps the text around it", () => {
      expect(textOf(parseAnsi("a\x1b[2Kb"))).toBe("ab");
    });

    it("drops an OSC title sequence terminated by BEL", () => {
      expect(textOf(parseAnsi("\x1b]0;my title\x07done"))).toBe("done");
    });

    it("drops an OSC sequence terminated by ST (ESC backslash)", () => {
      expect(textOf(parseAnsi("\x1b]0;t\x1b\\ok"))).toBe("ok");
    });
  });

  describe("given carriage returns", () => {
    it("overwrites the current line on a bare CR (progress-bar collapse)", () => {
      expect(textOf(parseAnsi("loading...\rdone"))).toBe("done");
    });

    it("treats CRLF as a single newline", () => {
      const lines = parseAnsi("a\r\nb");
      expect(lines).toHaveLength(2);
      expect(textOf(lines)).toBe("a\nb");
    });
  });

  describe("given malformed or binary input", () => {
    it("does not crash on a truncated escape at end of string", () => {
      expect(() => parseAnsi("abc\x1b[31")).not.toThrow();
      expect(textOf(parseAnsi("abc\x1b[31"))).toBe("abc");
    });

    it("keeps the line break after a CSI truncated mid-stream", () => {
      // Chunked output can cut a sequence short of its final byte; the `\n`
      // that follows is real content, not the sequence's final byte, and
      // eating it would glue two lines together.
      const lines = parseAnsi("abc\x1b[31\ndef");
      expect(lines).toHaveLength(2);
      expect(textOf(lines)).toBe("abc\ndef");
    });

    it("re-processes an interrupting ordinary character after a malformed CSI as text", () => {
      // Bytes below 0x40 cannot terminate a CSI; here a tab (0x09) interrupts
      // the digit run — the tab must survive as content, not be swallowed.
      expect(textOf(parseAnsi("a\x1b[3\tb"))).toBe("a\tb");
    });

    it("ignores a malformed extended-colour introducer", () => {
      const [seg] = segmentsOf(parseAnsi("\x1b[38;5mX"));
      expect(seg!.text).toBe("X");
      expect(seg!.style.fg).toBeUndefined();
    });

    it("ignores unknown SGR codes without dropping the text", () => {
      const [seg] = segmentsOf(parseAnsi("\x1b[999mX"));
      expect(seg!.text).toBe("X");
    });

    it("strips stray control bytes from binary content without throwing", () => {
      const binary = "\x00\x01\x02text\x07\x1b[31mmore";
      expect(() => parseAnsi(binary)).not.toThrow();
      expect(textOf(parseAnsi(binary))).toBe("textmore");
    });

    it("preserves tab characters", () => {
      expect(textOf(parseAnsi("a\tb"))).toBe("a\tb");
    });
  });

  describe("given a real coloured git status line", () => {
    it("splits the styled and unstyled runs", () => {
      const input =
        "On branch \x1b[32mmain\x1b[0m\n\x1b[31m\tmodified:   file.ts\x1b[0m";
      const lines = parseAnsi(input);
      expect(lines).toHaveLength(2);
      // Line 1: "On branch " (plain) + "main" (green)
      expect(lines[0]!.segments[0]).toEqual({
        text: "On branch ",
        style: {},
      });
      expect(lines[0]!.segments[1]).toEqual({
        text: "main",
        style: { fg: { kind: "named", name: "green" } },
      });
      // Line 2: whole thing red
      expect(lines[1]!.segments[0]!.style.fg).toEqual({
        kind: "named",
        name: "red",
      });
    });
  });
});

describe("stripAnsi", () => {
  it("removes every escape code, leaving clean text", () => {
    expect(stripAnsi("\x1b[1;31mError:\x1b[0m boom")).toBe("Error: boom");
  });

  it("is a no-op on plain text", () => {
    expect(stripAnsi("nothing to strip")).toBe("nothing to strip");
  });
});

describe("hasAnsi", () => {
  it("is true when an escape byte is present", () => {
    expect(hasAnsi("\x1b[31mx")).toBe(true);
  });

  it("is false for plain text", () => {
    expect(hasAnsi("plain")).toBe(false);
  });
});

describe("xterm256ToHex", () => {
  it("maps the cube corners", () => {
    expect(xterm256ToHex(16)).toBe("#000000");
    expect(xterm256ToHex(231)).toBe("#ffffff");
    expect(xterm256ToHex(21)).toBe("#0000ff");
  });

  it("maps the grayscale ramp ends", () => {
    expect(xterm256ToHex(232)).toBe("#080808");
    expect(xterm256ToHex(255)).toBe("#eeeeee");
  });
});
