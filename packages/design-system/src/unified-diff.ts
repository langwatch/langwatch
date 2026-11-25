export type DiffLineKind = "add" | "remove" | "context" | "hunk" | "meta";

export interface DiffLine {
  kind: DiffLineKind;
  /** The line without its `+`, `-` or space marker. */
  text: string;
  /** 1-based number in the old file; null on an added line or a header. */
  oldLine: number | null;
  /** 1-based number in the new file; null on a removed line or a header. */
  newLine: number | null;
}

const HUNK = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/;
const FILE_HEADER =
  /^(diff |index |--- |\+\+\+ |new file mode|deleted file mode|similarity index|rename (from|to) )/;

/**
 * Reads a unified diff line by line. A diff with no `@@` headers (a model's
 * bare `+`/`-` lines) still numbers from 1; file headers only count before a hunk.
 */
export function parseUnifiedDiff(diff: string): DiffLine[] {
  let oldLine = 1;
  let newLine = 1;
  let inHunk = false;

  return diff.split("\n").map((line): DiffLine => {
    const hunk = HUNK.exec(line);
    if (hunk) {
      oldLine = Number(hunk[1]);
      newLine = Number(hunk[2]);
      inHunk = true;
      return { kind: "hunk", text: line, oldLine: null, newLine: null };
    }
    if (line.startsWith("diff ")) inHunk = false;
    if ((!inHunk && FILE_HEADER.test(line)) || line.startsWith("\\ ")) {
      return { kind: "meta", text: line, oldLine: null, newLine: null };
    }
    if (line.startsWith("+")) {
      return { kind: "add", text: line.slice(1), oldLine: null, newLine: newLine++ };
    }
    if (line.startsWith("-")) {
      return { kind: "remove", text: line.slice(1), oldLine: oldLine++, newLine: null };
    }
    return {
      kind: "context",
      text: line.startsWith(" ") ? line.slice(1) : line,
      oldLine: oldLine++,
      newLine: newLine++,
    };
  });
}
