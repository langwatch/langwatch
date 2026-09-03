export type DiffLineKind = "context" | "add" | "remove";

export interface DiffLine {
  kind: DiffLineKind;
  text: string;
  oldLineNo?: number;
  newLineNo?: number;
}

const MAX_DIFF_LINES = 4000;

export function computeLineDiff(oldText: string, newText: string): DiffLine[] {
  const oldLines = splitLines(oldText);
  const newLines = splitLines(newText);

  if (oldLines.length + newLines.length > MAX_DIFF_LINES) {
    return [
      ...oldLines.map((text, index) => ({
        kind: "remove" as const,
        text,
        oldLineNo: index + 1,
      })),
      ...newLines.map((text, index) => ({
        kind: "add" as const,
        text,
        newLineNo: index + 1,
      })),
    ];
  }

  const lcs: number[][] = Array.from({ length: oldLines.length + 1 }, () =>
    Array.from({ length: newLines.length + 1 }, () => 0),
  );
  for (let oldIndex = oldLines.length - 1; oldIndex >= 0; oldIndex--) {
    for (let newIndex = newLines.length - 1; newIndex >= 0; newIndex--) {
      const current = lcs[oldIndex];
      if (!current) {
        continue;
      }

      const sameLine = oldLines[oldIndex] === newLines[newIndex];
      const nextOld = lcsValue(lcs, oldIndex + 1, newIndex);
      const nextNew = lcsValue(lcs, oldIndex, newIndex + 1);
      const diagonal = lcsValue(lcs, oldIndex + 1, newIndex + 1);
      current[newIndex] = sameLine ? diagonal + 1 : Math.max(nextOld, nextNew);
    }
  }

  const result: DiffLine[] = [];
  let oldIndex = 0;
  let newIndex = 0;
  while (oldIndex < oldLines.length && newIndex < newLines.length) {
    if (oldLines[oldIndex] === newLines[newIndex]) {
      const text = lineAt(oldLines, oldIndex);
      result.push({
        kind: "context",
        text,
        oldLineNo: oldIndex + 1,
        newLineNo: newIndex + 1,
      });
      oldIndex++;
      newIndex++;
    } else if (
      lcsValue(lcs, oldIndex + 1, newIndex) >= lcsValue(lcs, oldIndex, newIndex + 1)
    ) {
      result.push({
        kind: "remove",
        text: lineAt(oldLines, oldIndex),
        oldLineNo: oldIndex + 1,
      });
      oldIndex++;
    } else {
      result.push({
        kind: "add",
        text: lineAt(newLines, newIndex),
        newLineNo: newIndex + 1,
      });
      newIndex++;
    }
  }
  while (oldIndex < oldLines.length) {
    result.push({
      kind: "remove",
      text: lineAt(oldLines, oldIndex),
      oldLineNo: oldIndex + 1,
    });
    oldIndex++;
  }
  while (newIndex < newLines.length) {
    result.push({
      kind: "add",
      text: lineAt(newLines, newIndex),
      newLineNo: newIndex + 1,
    });
    newIndex++;
  }
  return result;
}

export function diffStat(lines: DiffLine[]): { added: number; removed: number } {
  let added = 0;
  let removed = 0;
  for (const line of lines) {
    if (line.kind === "add") {
      added++;
    }
    if (line.kind === "remove") {
      removed++;
    }
  }
  return { added, removed };
}

function lcsValue(matrix: number[][], row: number, column: number): number {
  return matrix[row]?.[column] ?? 0;
}

function lineAt(lines: string[], index: number): string {
  return lines[index] ?? "";
}

function splitLines(text: string): string[] {
  if (text.length === 0) {
    return [];
  }
  const normalized = text.replace(/\r\n/g, "\n");
  const withoutTrailingNewline = normalized.endsWith("\n")
    ? normalized.slice(0, -1)
    : normalized;
  return withoutTrailingNewline.split("\n");
}
