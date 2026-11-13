/**
 * Terminal output read into card text: escapes gone, redrawn progress dropped, exit code read.
 * @see specs/langy/langy-local-control.feature
 *      "A failed command says its exit code and its last error line"
 */

/**
 * CSI (colours, cursor moves, line erases); the string sequences OSC, DCS, SOS, PM and APC
 * through BEL, ST or the end of a cut output; and any other two-byte escape.
 */
const ESCAPE_OR_BREAK =
  // eslint-disable-next-line no-control-regex -- matching terminal control bytes is the whole point
  /(\u001b\[|\u009b)([0-?]*)[ -/]*([@-~])|\u001b[\]PX^_][^\u0007\u001b]*(?:\u0007|\u001b\\|$)|\u001b[@-Z\\-_]|\r|\n/g;
// eslint-disable-next-line no-control-regex -- the control bytes left once every escape is replayed
const STRAY_CONTROL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g;

/**
 * Replays the few moves progress bars make (carriage return, erase line, cursor up)
 * on a list of lines, so a redrawn bar ends as what the terminal last showed. A
 * carriage return clears the line: a redraw rewrites it whole.
 */
export function cleanTerminalText(text: string): string {
  const normalized = text.replace(/\r\n/g, "\n");
  const lines: string[] = [];
  let current = "";
  let from = 0;
  for (const match of normalized.matchAll(ESCAPE_OR_BREAK)) {
    current += normalized.slice(from, match.index);
    from = match.index + match[0].length;
    const [token, csi, params = "", final] = match;
    if (token === "\n") {
      lines.push(current);
      current = "";
    } else if (token === "\r" || (csi && final === "K")) {
      current = "";
    } else if (csi && final === "A") {
      const up = Math.max(1, Number.parseInt(params, 10) || 1);
      for (let step = 0; step < up && lines.length > 0; step++) current = lines.pop() ?? "";
    }
  }
  lines.push(current + normalized.slice(from));
  return lines.join("\n").replace(STRAY_CONTROL, "");
}

/** A shell result the worker rendered, as `renderBashOutput` writes it. */
const SHELL_RESULT = /^exit code: (\d+|none)\n\nstdout:\n([\s\S]*?)\n\nstderr:\n([\s\S]*)$/;

/** Lines that say nothing about why a command failed. */
const NOISE = [
  /^\(empty\)$/,
  /^warning\b/i,
  /\b[A-Z]\w*Warning\b/,
  /^hint\b/i,
  /^File "[^"]+", line \d+/,
  /^at .+:\d+:\d+\)?$/,
  /^The output is cut at the size limit/,
];
const ERROR_MARK =
  /\b(error|failed|failure|exception|fatal|denied|cannot|can't|unable|unsatisfiable|not found|no such)\b|^[A-Za-z_][\w.]*(?:Error|Exception)\b|^×/i;
/** uv's and the CLI's leading glyphs, which frame a line but are not part of it. */
const LEADING_GLYPHS = /^[×✖╰─▶│├└\s]+/;

function meaningfulLines(stream: string): { line: string; marked: boolean }[] {
  return stream
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !NOISE.some((noise) => noise.test(line)))
    .map((line) => ({
      line: line.replace(LEADING_GLYPHS, "").trim(),
      marked: ERROR_MARK.test(line),
    }))
    .filter(({ line }) => line.length > 0);
}

/** The last line that names an error, stderr first; else the last line printed at all. */
function lastErrorLine({ stdout, stderr }: { stdout: string; stderr: string }): string | undefined {
  const streams = [meaningfulLines(stderr), meaningfulLines(stdout)];
  const marked = streams.map((lines) => lines.findLast((entry) => entry.marked)).find(Boolean);
  const any = streams.map((lines) => lines.at(-1)).find(Boolean);
  return (marked ?? any)?.line.slice(0, 300);
}

export interface ShellFailure {
  /** Null when the command ended without one, killed by a signal. */
  exitCode: number | null;
  lastErrorLine?: string;
}

/** A shell result's exit code and last error line, or null when the text is not one. */
export function readShellFailure(text: string): ShellFailure | null {
  const match = SHELL_RESULT.exec(text);
  if (!match) return null;
  const [, code = "none", stdout = "", stderr = ""] = match;
  const line = lastErrorLine({ stdout, stderr });
  return {
    exitCode: code === "none" ? null : Number(code),
    ...(line ? { lastErrorLine: line } : {}),
  };
}
