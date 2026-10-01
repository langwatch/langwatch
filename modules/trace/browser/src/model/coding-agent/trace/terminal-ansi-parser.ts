/**
 * Parse ANSI SGR escape codes to styled segments; understands 16 base colors,
 * xterm-256, truecolor, and attributes (bold/dim/italic/underline/inverse/strikethrough).
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
export type AnsiColor = { kind: "named"; name: AnsiColorName } | { kind: "rgb"; hex: string };

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
  if (!Number.isFinite(index) || index < 0 || index > 255) return void 0;
  if (index < 8) return { kind: "named", name: NAMED[index]! };
  if (index < 16) return { kind: "named", name: BRIGHT_NAMED[index - 8]! };
  return { kind: "rgb", hex: xterm256ToHex(index) };
}

type StyleFlag = "bold" | "dim" | "italic" | "underline" | "inverse" | "strikethrough";

const SGR_SETS: Partial<Record<number, StyleFlag>> = {
  1: "bold",
  2: "dim",
  3: "italic",
  4: "underline",
  7: "inverse",
  9: "strikethrough",
};

const SGR_CLEARS: Partial<Record<number, (keyof AnsiStyle)[]>> = {
  22: ["bold", "dim"],
  23: ["italic"],
  24: ["underline"],
  27: ["inverse"],
  29: ["strikethrough"],
  39: ["fg"],
  49: ["bg"],
};

/** An empty parameter list (`ESC[m`) is a full reset, same as `ESC[0m`. */
function parseSgrCodes(params: string): number[] {
  if (params.length === 0) return [0];
  return params.split(";").map((p) => {
    const n = parseInt(p, 10);
    return Number.isNaN(n) ? 0 : n;
  });
}

/**
 * Extended colour at `codes[at]`: `38;5;n` (256) or `38;2;r;g;b` (truecolor); a malformed
 * introducer is skipped, not a crash. Answers how many further codes it consumed.
 */
function applyExtendedColor({
  next,
  codes,
  at,
}: {
  next: AnsiStyle;
  codes: number[];
  at: number;
}): number {
  const target: "fg" | "bg" = codes[at] === 38 ? "fg" : "bg";
  const mode = codes[at + 1];
  if (mode === 5) {
    const resolved = colorFrom256(codes[at + 2] ?? -1);
    if (resolved) next[target] = resolved;
    return 2;
  }
  if (mode !== 2) return 1;
  const [r, g, b] = [codes[at + 2], codes[at + 3], codes[at + 4]];
  if (r != null && g != null && b != null) next[target] = { kind: "rgb", hex: rgbToHex(r, g, b) };
  return 4;
}

/** The 16-colour foreground and background ranges; any other code (blink, font, …) is ignored. */
function applyBasicColor(next: AnsiStyle, code: number): void {
  if (code >= 30 && code <= 37) next.fg = { kind: "named", name: NAMED[code - 30]! };
  else if (code >= 90 && code <= 97) next.fg = { kind: "named", name: BRIGHT_NAMED[code - 90]! };
  else if (code >= 40 && code <= 47) next.bg = { kind: "named", name: NAMED[code - 40]! };
  else if (code >= 100 && code <= 107) {
    next.bg = { kind: "named", name: BRIGHT_NAMED[code - 100]! };
  }
}

function applySimpleCode(next: AnsiStyle, code: number): void {
  const flag = SGR_SETS[code];
  if (flag) {
    next[flag] = true;
    return;
  }
  const cleared = SGR_CLEARS[code];
  if (!cleared) {
    applyBasicColor(next, code);
    return;
  }
  for (const key of cleared) delete next[key];
}

/**
 * Apply one SGR escape's parameters onto a style, returning a new style.
 * `params` is the raw content between `ESC[` and `m` (e.g. `"1;38;5;196"`).
 */
function applySgr(style: AnsiStyle, params: string): AnsiStyle {
  const codes = parseSgrCodes(params);
  let next: AnsiStyle = { ...style };
  for (let i = 0; i < codes.length; i++) {
    const code = codes[i]!;
    if (code === 0) next = {};
    else if (code === 38 || code === 48) i += applyExtendedColor({ next, codes, at: i });
    else applySimpleCode(next, code);
  }
  return next;
}

function styleKey(style: AnsiStyle): string {
  return JSON.stringify(style);
}

/**
 * One escape sequence at `at`: an SGR sets the style, OSC and any other escape
 * (charset select `ESC(`, `ESC=`, a lone ESC at the end) are dropped whole.
 */
function readEscape({ input, at, style }: { input: string; at: number; style: AnsiStyle }): {
  next: number;
  style: AnsiStyle;
} {
  const nextCh = input[at + 1];
  if (nextCh === "[") {
    const csi = scanCsi(input, at);
    return {
      next: csi.next,
      style: csi.sgrParams === null ? style : applySgr(style, csi.sgrParams),
    };
  }
  if (nextCh === "]") return { next: scanOsc(input, at), style };

  return { next: at + (nextCh === void 0 ? 1 : 2), style };
}

/** The lines being built: the open line's segments, its unflushed text and the current style. */
class AnsiLineBuilder {
  readonly lines: AnsiLine[] = [];
  #segments: AnsiSegment[] = [];
  #buffer = "";
  #style: AnsiStyle = {};

  get style(): AnsiStyle {
    return this.#style;
  }

  append(ch: string): void {
    this.#buffer += ch;
  }

  setStyle(nextStyle: AnsiStyle): void {
    if (styleKey(nextStyle) === styleKey(this.#style)) return;
    this.#flushSegment();
    this.#style = nextStyle;
  }

  pushLine(): void {
    this.#flushSegment();
    this.lines.push({ segments: this.#segments });
    this.#segments = [];
  }

  /** Clears the open line's visible content, keeping the style. */
  clearLine(): void {
    this.#buffer = "";
    this.#segments = [];
  }

  hasOpenContent(): boolean {
    return this.#buffer.length > 0 || this.#segments.length > 0;
  }

  #flushSegment(): void {
    if (this.#buffer.length === 0) return;
    this.#segments.push({ text: this.#buffer, style: { ...this.#style } });
    this.#buffer = "";
  }
}

/** Consumes the character or sequence at `at` into `out`; answers where the next one starts. */
function consumeAnsi({
  input,
  at,
  out,
}: {
  input: string;
  at: number;
  out: AnsiLineBuilder;
}): number {
  const ch = input[at]!;
  if (ch === ESC) {
    const escape = readEscape({ input, at, style: out.style });
    out.setStyle(escape.style);
    return escape.next;
  }
  if (ch === "\n") {
    out.pushLine();
    return at + 1;
  }
  if (ch === "\r") {
    // \r\n is one newline. A bare \r moves the cursor to column 0 and later text
    // overwrites, so the line collapses to its final frame.
    if (input[at + 1] === "\n") {
      out.pushLine();
      return at + 2;
    }
    out.clearLine();
    return at + 1;
  }
  // Other C0 controls (bell, backspace, NUL, stray binary) would render as replacement glyphs.
  if (input.charCodeAt(at) < 0x20 && ch !== "\t") return at + 1;

  out.append(ch);
  return at + 1;
}

/**
 * Parse raw string with ANSI codes into styled lines; handles carriage returns
 * (terminal overwrite), non-SGR control sequences (dropped), never throws.
 */
export function parseAnsi(input: string): AnsiLine[] {
  const out = new AnsiLineBuilder();
  let i = 0;
  while (i < input.length) i = consumeAnsi({ input, at: i, out });

  // The trailing line is emitted when it holds anything; an entirely empty
  // input still answers one empty line, so callers always get at least one.
  if (out.hasOpenContent()) out.pushLine();
  else if (out.lines.length === 0) out.lines.push({ segments: [] });

  return out.lines;
}

/**
 * Scan CSI sequence; returns resume index and SGR param string (or null for
 * non-SGR). Handles interrupted sequences without swallowing following characters.
 */
function scanCsi(input: string, start: number): { next: number; sgrParams: string | null } {
  const len = input.length;
  let j = start + 2;
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
  return {
    next: hasValidFinalByte ? j + 1 : j,
    sgrParams: hasValidFinalByte && input[j] === "m" ? input.slice(start + 2, j) : null,
  };
}

/**
 * Scan an OSC sequence (`ESC ] … (BEL | ESC \)`) starting at the ESC at
 * `start` — window titles and the like. Returns the index just past its
 * terminator, or the end of input when unterminated.
 */
function scanOsc(input: string, start: number): number {
  const len = input.length;
  let j = start + 2;
  while (j < len) {
    if (input[j] === "\x07") return j + 1;
    if (input[j] === ESC && input[j + 1] === "\\") return j + 2;
    j++;
  }
  return j;
}
