/**
 * Minimal, dependency-free ANSI SGR parser.
 *
 * Claude Code (and any `xterm-256color` session) emits tool output — `git`,
 * test runners, build tools — peppered with raw ANSI escape codes
 * (`\x1b[32m…\x1b[0m`). Rendered verbatim that's noise. This parser turns a
 * raw string into styled lines/segments that a React component can paint as
 * real colours.
 *
 * Scope: it understands SGR (Select Graphic Rendition, the `ESC[…m` family):
 * the 16 base colours, xterm-256 (`38;5;n` / `48;5;n`), truecolor
 * (`38;2;r;g;b`), and the bold/dim/italic/underline/inverse/strikethrough
 * attributes plus their resets. Every other control sequence (cursor moves,
 * screen clears, OSC title-setting) is recognised and *dropped* so it never
 * leaks into the visible text. Carriage returns collapse to the terminal's
 * overwrite behaviour so progress bars don't spam the output.
 *
 * The parser is deliberately palette-free: colours come back as either a
 * *named* ANSI colour (which the renderer maps to a theme-aware token, so the
 * same "red" reads correctly in light and dark) or a concrete rgb hex (for
 * 256/truecolor, which have no theme-aware equivalent). See
 * `terminalView/palette.ts` for the mapping.
 */

const ESC = "\x1b";

export type AnsiColorName =
  | "black"
  | "red"
  | "green"
  | "yellow"
  | "blue"
  | "magenta"
  | "cyan"
  | "white"
  | "brightBlack"
  | "brightRed"
  | "brightGreen"
  | "brightYellow"
  | "brightBlue"
  | "brightMagenta"
  | "brightCyan"
  | "brightWhite";

/**
 * A resolved colour. `named` values stay theme-aware (mapped to a palette by
 * the renderer); `rgb` values are concrete hex from 256-colour/truecolor
 * codes, which carry their own absolute colour.
 */
export type AnsiColor =
  | { kind: "named"; name: AnsiColorName }
  | { kind: "rgb"; hex: string };

export interface AnsiStyle {
  fg?: AnsiColor;
  bg?: AnsiColor;
  bold?: boolean;
  dim?: boolean;
  italic?: boolean;
  underline?: boolean;
  /** Swap foreground/background (SGR 7). Applied by the renderer. */
  inverse?: boolean;
  strikethrough?: boolean;
}

export interface AnsiSegment {
  text: string;
  style: AnsiStyle;
}

export interface AnsiLine {
  segments: AnsiSegment[];
}

const NAMED: AnsiColorName[] = [
  "black",
  "red",
  "green",
  "yellow",
  "blue",
  "magenta",
  "cyan",
  "white",
];

const BRIGHT_NAMED: AnsiColorName[] = [
  "brightBlack",
  "brightRed",
  "brightGreen",
  "brightYellow",
  "brightBlue",
  "brightMagenta",
  "brightCyan",
  "brightWhite",
];

/** True when the string carries any ESC control sequence worth parsing. */
export function hasAnsi(input: string): boolean {
  return input.indexOf(ESC) !== -1;
}

/**
 * Return the plain text with every ANSI/control sequence removed. Handy for
 * copy-to-clipboard and for length/preview heuristics.
 */
export function stripAnsi(input: string): string {
  return parseAnsi(input)
    .map((line) => line.segments.map((s) => s.text).join(""))
    .join("\n");
}

/** Convert an xterm-256 colour index (0-255) to an rgb hex string. */
export function xterm256ToHex(index: number): string {
  // 0-15: the 16 system colours. Callers map these to named colours instead
  // (so they stay theme-aware), but resolve them here too for completeness.
  const SYSTEM: string[] = [
    "#000000",
    "#cd0000",
    "#00cd00",
    "#cdcd00",
    "#0000ee",
    "#cd00cd",
    "#00cdcd",
    "#e5e5e5",
    "#7f7f7f",
    "#ff0000",
    "#00ff00",
    "#ffff00",
    "#5c5cff",
    "#ff00ff",
    "#00ffff",
    "#ffffff",
  ];
  if (index < 16) return SYSTEM[index] ?? "#000000";
  // 16-231: 6×6×6 colour cube.
  if (index < 232) {
    const i = index - 16;
    const r = Math.floor(i / 36);
    const g = Math.floor((i % 36) / 6);
    const b = i % 6;
    const level = (v: number) => (v === 0 ? 0 : v * 40 + 55);
    return rgbToHex(level(r), level(g), level(b));
  }
  // 232-255: 24-step grayscale ramp.
  const v = 8 + (index - 232) * 10;
  return rgbToHex(v, v, v);
}

function rgbToHex(r: number, g: number, b: number): string {
  const clamp = (v: number) => Math.max(0, Math.min(255, Math.round(v)));
  const hex = (v: number) => clamp(v).toString(16).padStart(2, "0");
  return `#${hex(r)}${hex(g)}${hex(b)}`;
}

/** Resolve a 256-colour index to a theme-aware named colour or concrete hex. */
function colorFrom256(index: number): AnsiColor | undefined {
  if (!Number.isFinite(index) || index < 0 || index > 255) return undefined;
  if (index < 8) return { kind: "named", name: NAMED[index]! };
  if (index < 16) return { kind: "named", name: BRIGHT_NAMED[index - 8]! };
  return { kind: "rgb", hex: xterm256ToHex(index) };
}

/**
 * Apply one SGR escape's parameters onto a style, returning a new style.
 * `params` is the raw content between `ESC[` and `m` (e.g. `"1;38;5;196"`).
 */
function applySgr(style: AnsiStyle, params: string): AnsiStyle {
  // An empty parameter list (`ESC[m`) is a full reset, same as `ESC[0m`.
  const codes =
    params.length === 0
      ? [0]
      : params.split(";").map((p) => {
          const n = parseInt(p, 10);
          return Number.isNaN(n) ? 0 : n;
        });

  const next: AnsiStyle = { ...style };

  for (let i = 0; i < codes.length; i++) {
    const code = codes[i]!;
    switch (code) {
      case 0:
        // Full reset — drop every attribute.
        for (const k of Object.keys(next) as (keyof AnsiStyle)[]) {
          delete next[k];
        }
        break;
      case 1:
        next.bold = true;
        break;
      case 2:
        next.dim = true;
        break;
      case 3:
        next.italic = true;
        break;
      case 4:
        next.underline = true;
        break;
      case 7:
        next.inverse = true;
        break;
      case 9:
        next.strikethrough = true;
        break;
      case 22:
        delete next.bold;
        delete next.dim;
        break;
      case 23:
        delete next.italic;
        break;
      case 24:
        delete next.underline;
        break;
      case 27:
        delete next.inverse;
        break;
      case 29:
        delete next.strikethrough;
        break;
      case 38:
      case 48: {
        // Extended colour: `38;5;n` (256) or `38;2;r;g;b` (truecolor).
        const target: "fg" | "bg" = code === 38 ? "fg" : "bg";
        const mode = codes[i + 1];
        if (mode === 5) {
          const resolved = colorFrom256(codes[i + 2] ?? -1);
          if (resolved) next[target] = resolved;
          i += 2;
        } else if (mode === 2) {
          const r = codes[i + 2];
          const g = codes[i + 3];
          const b = codes[i + 4];
          if (r != null && g != null && b != null) {
            next[target] = { kind: "rgb", hex: rgbToHex(r, g, b) };
          }
          i += 4;
        } else {
          // Malformed extended-colour introducer — skip it, don't crash.
          i += 1;
        }
        break;
      }
      case 39:
        delete next.fg;
        break;
      case 49:
        delete next.bg;
        break;
      default:
        if (code >= 30 && code <= 37) {
          next.fg = { kind: "named", name: NAMED[code - 30]! };
        } else if (code >= 90 && code <= 97) {
          next.fg = { kind: "named", name: BRIGHT_NAMED[code - 90]! };
        } else if (code >= 40 && code <= 47) {
          next.bg = { kind: "named", name: NAMED[code - 40]! };
        } else if (code >= 100 && code <= 107) {
          next.bg = { kind: "named", name: BRIGHT_NAMED[code - 100]! };
        }
        // Any other code (blink, font selection, …) is intentionally ignored.
        break;
    }
  }

  return next;
}

function styleKey(style: AnsiStyle): string {
  return JSON.stringify(style);
}

/**
 * Parse a raw string containing ANSI escape codes into styled lines. Each line
 * is a list of contiguous same-style segments. Newlines split lines; a bare
 * carriage return (no following newline) resets the current line's visible
 * content, mimicking a terminal's overwrite so progress output collapses to
 * its final frame. Non-SGR control sequences and stray control characters are
 * dropped. Never throws — malformed or binary input degrades to best-effort
 * text.
 */
export function parseAnsi(input: string): AnsiLine[] {
  const lines: AnsiLine[] = [];
  let segments: AnsiSegment[] = [];
  let buffer = "";
  let style: AnsiStyle = {};

  const flushSegment = () => {
    if (buffer.length === 0) return;
    segments.push({ text: buffer, style: { ...style } });
    buffer = "";
  };

  const pushLine = () => {
    flushSegment();
    lines.push({ segments });
    segments = [];
  };

  const setStyle = (nextStyle: AnsiStyle) => {
    if (styleKey(nextStyle) === styleKey(style)) return;
    flushSegment();
    style = nextStyle;
  };

  const len = input.length;
  let i = 0;
  while (i < len) {
    const ch = input[i]!;

    if (ch === ESC) {
      const nextCh = input[i + 1];
      if (nextCh === "[") {
        // CSI: params/intermediates (0x20-0x3F) then one final byte
        // (0x40-0x7E). We only act on the SGR final byte `m`; the rest
        // (cursor moves, clears, …) are consumed and dropped.
        let j = i + 2;
        while (j < len) {
          const code = input.charCodeAt(j);
          if (code >= 0x20 && code <= 0x3f) {
            j++;
            continue;
          }
          break;
        }
        const finalCode = j < len ? input.charCodeAt(j) : -1;
        const hasValidFinalByte = finalCode >= 0x40 && finalCode <= 0x7e;
        if (hasValidFinalByte && input[j] === "m") {
          setStyle(applySgr(style, input.slice(i + 2, j)));
        }
        // Consume the final byte only when it really is one. A sequence
        // interrupted mid-params (chunked/truncated output) is followed by a
        // REAL character — often `\n` — which must be re-processed as text,
        // not swallowed as the sequence's final byte (that eats line breaks).
        i = hasValidFinalByte ? j + 1 : j;
        continue;
      }
      if (nextCh === "]") {
        // OSC: `ESC ] … (BEL | ESC \)`. Used for window titles etc. Skip the
        // whole thing.
        let j = i + 2;
        while (j < len) {
          if (input[j] === "\x07") {
            j++;
            break;
          }
          if (input[j] === ESC && input[j + 1] === "\\") {
            j += 2;
            break;
          }
          j++;
        }
        i = j;
        continue;
      }
      // Some other escape (charset select `ESC(`, `ESC=`, a lone ESC at end
      // of string, …). Drop ESC and the byte after it.
      i += nextCh === undefined ? 1 : 2;
      continue;
    }

    if (ch === "\n") {
      pushLine();
      i++;
      continue;
    }

    if (ch === "\r") {
      // Carriage return without a newline: the terminal would move the cursor
      // to column 0 and subsequent text overwrites. Collapse to the final
      // frame by clearing the current line's visible content (keeping style).
      if (input[i + 1] === "\n") {
        // \r\n — treat as a single newline.
        pushLine();
        i += 2;
        continue;
      }
      buffer = "";
      segments = [];
      i++;
      continue;
    }

    const code = input.charCodeAt(i);
    if (code < 0x20 && ch !== "\t") {
      // Drop other C0 control characters (bell, backspace, form feed, NUL,
      // and any stray bytes from binary content) so they don't render as
      // replacement glyphs.
      i++;
      continue;
    }

    buffer += ch;
    i++;
  }

  // Flush the trailing line (even if empty, when there was prior content, to
  // preserve a final newline's worth of structure). Only emit a trailing
  // empty line if the input ended on a newline handled above; otherwise emit
  // whatever is buffered.
  if (buffer.length > 0 || segments.length > 0) {
    pushLine();
  } else if (lines.length === 0) {
    // Entirely empty input → one empty line, so callers always get ≥1 line.
    lines.push({ segments: [] });
  }

  return lines;
}
