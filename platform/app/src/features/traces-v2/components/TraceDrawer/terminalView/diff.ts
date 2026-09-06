/**
 * Minimal line-based diff, used to recreate Claude Code's Edit/Write diff
 * blocks (removed lines in red, added lines in green, context dimmed). Pure and
 * dependency-free so it's cheap to unit-test.
 *
 * The algorithm is a standard longest-common-subsequence over lines with a
 * backtrack — good enough for the file-edit-sized inputs these tool calls
 * carry, and it produces the classic unified-diff ordering (a removed line
 * immediately followed by its replacement).
 */

export type DiffLineKind = "context" | "add" | "remove";

export interface DiffLine {
  kind: DiffLineKind;
  text: string;
  /** 1-based line number in the old text (absent for added lines). */
  oldLineNo?: number;
  /** 1-based line number in the new text (absent for removed lines). */
  newLineNo?: number;
}

/** Guardrail: skip the O(n·m) LCS table for pathologically large inputs. */
const MAX_DIFF_LINES = 4000;

export function computeLineDiff(oldText: string, newText: string): DiffLine[] {
  const oldLines = splitLines(oldText);
  const newLines = splitLines(newText);

  // For very large inputs, fall back to a naive "remove all / add all" rather
  // than allocate a huge LCS table.
  if (oldLines.length + newLines.length > MAX_DIFF_LINES) {
    return [
      ...oldLines.map((text, i) => ({
        kind: "remove" as const,
        text,
        oldLineNo: i + 1,
      })),
      ...newLines.map((text, i) => ({
        kind: "add" as const,
        text,
        newLineNo: i + 1,
      })),
    ];
  }

  const n = oldLines.length;
  const m = newLines.length;

  // lcs[i][j] = length of LCS of oldLines[i..] and newLines[j..].
  const lcs: number[][] = Array.from({ length: n + 1 }, () =>
    new Array<number>(m + 1).fill(0),
  );
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      lcs[i]![j] =
        oldLines[i] === newLines[j]
          ? lcs[i + 1]![j + 1]! + 1
          : Math.max(lcs[i + 1]![j]!, lcs[i]![j + 1]!);
    }
  }

  const out: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (oldLines[i] === newLines[j]) {
      out.push({
        kind: "context",
        text: oldLines[i]!,
        oldLineNo: i + 1,
        newLineNo: j + 1,
      });
      i++;
      j++;
    } else if (lcs[i + 1]![j]! >= lcs[i]![j + 1]!) {
      out.push({ kind: "remove", text: oldLines[i]!, oldLineNo: i + 1 });
      i++;
    } else {
      out.push({ kind: "add", text: newLines[j]!, newLineNo: j + 1 });
      j++;
    }
  }
  while (i < n) {
    out.push({ kind: "remove", text: oldLines[i]!, oldLineNo: i + 1 });
    i++;
  }
  while (j < m) {
    out.push({ kind: "add", text: newLines[j]!, newLineNo: j + 1 });
    j++;
  }
  return out;
}

/** Count added/removed lines in a diff, for a `+N -M` summary chip. */
export function diffStat(lines: DiffLine[]): {
  added: number;
  removed: number;
} {
  let added = 0;
  let removed = 0;
  for (const line of lines) {
    if (line.kind === "add") added++;
    else if (line.kind === "remove") removed++;
  }
  return { added, removed };
}

function splitLines(text: string): string[] {
  // An empty string is zero lines (an empty file), not one empty line.
  if (text.length === 0) return [];
  const normalized = text.replace(/\r\n/g, "\n");
  // Drop a single trailing newline so "a\n" is one line, not one line + empty.
  const trimmed = normalized.endsWith("\n")
    ? normalized.slice(0, -1)
    : normalized;
  return trimmed.split("\n");
}
