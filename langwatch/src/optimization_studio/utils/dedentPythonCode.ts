/**
 * Remove the leading whitespace common to every non-blank line — the TS twin
 * of Python's `textwrap.dedent`.
 *
 * Why this exists: a code-agent block pasted into Monaco can pick up a uniform
 * indent on every line (auto-indent on paste). That indent persists to the DB
 * and later crashes the code-block runner's `compile()` with IndentationError
 * (issue #3013). Stripping the common indent restores the canonical, flush form.
 *
 * Blank / whitespace-only lines are ignored when computing the common indent and
 * are emptied in the output — matching CPython's textwrap.dedent. Already-flush
 * code is returned unchanged.
 */
export function dedentPythonCode(code: string): string {
  const lines = code.split("\n");
  let common: string | null = null;
  for (const line of lines) {
    if (line.trim() === "") continue; // ignore whitespace-only lines
    const indent = /^[ \t]*/.exec(line)![0];
    if (common === null) {
      common = indent;
      continue;
    }
    // shrink `common` to the longest shared leading-whitespace prefix
    let i = 0;
    const max = Math.min(common.length, indent.length);
    while (i < max && common[i] === indent[i]) i++;
    common = common.slice(0, i);
    if (common === "") break;
  }
  const prefix = common ?? "";
  return lines
    .map((line) =>
      line.trim() === ""
        ? "" // whitespace-only lines collapse to empty (matching textwrap.dedent)
        : line.startsWith(prefix)
          ? line.slice(prefix.length)
          : line,
    )
    .join("\n");
}
