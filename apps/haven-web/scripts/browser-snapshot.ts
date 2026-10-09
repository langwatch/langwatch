/** Trims an ai-mode aria snapshot for `haven browser snapshot`. */

export type SnapshotFilter = { grep?: string; depth?: number; maxChars?: number };

const depthOf = (line: string) => (line.length - line.trimStart().length) >> 1;

/** The lines containing needle (any case), each with the chain of ancestors above it. */
function grepLines({ lines, grep }: { lines: string[]; grep: string }) {
  const needle = grep.toLowerCase();
  const keep = new Set<number>();
  lines.forEach((line, index) => {
    if (!line.toLowerCase().includes(needle)) return;
    keep.add(index);
    let want = depthOf(line);
    for (let up = index - 1; up >= 0 && want > 0; up -= 1) {
      if (depthOf(lines[up] ?? "") >= want) continue;
      keep.add(up);
      want = depthOf(lines[up] ?? "");
    }
  });
  return lines.filter((_, index) => keep.has(index));
}

function capLines({ lines, maxChars }: { lines: string[]; maxChars: number }) {
  let used = 0;
  const kept: string[] = [];
  for (const line of lines) {
    if (used + line.length + 1 > maxChars) break;
    kept.push(line);
    used += line.length + 1;
  }
  if (kept.length === lines.length) return kept.join("\n");
  const note = `${lines.length - kept.length} lines omitted`;
  return `${kept.join("\n")}\n... truncated at ${maxChars} chars (${note}); narrow with --grep <text>`;
}

/** --grep keeps matches and ancestors, --depth cuts below N levels, --max-chars cuts at a line. */
export function filterSnapshot({ text, grep, depth, maxChars }: { text: string } & SnapshotFilter) {
  let lines = text.split("\n");
  if (grep) lines = grepLines({ lines, grep });
  if (depth !== undefined) lines = lines.filter((line) => depthOf(line) < depth);
  return maxChars ? capLines({ lines, maxChars }) : lines.join("\n");
}
