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
// Only spaces and tabs count as indentation, matching CPython's
// `([ \t]*)(?=[^ \t\n])` — `trimStart()` would also eat exotic whitespace
// (a non-breaking space from a browser paste) and diverge from it.
function leadingWhitespace(line: string): string {
  return /^[ \t]*/.exec(line)?.[0] ?? "";
}

/** The longest leading substring shared by `a` and `b`. */
function commonPrefix(a: string, b: string): string {
  let i = 0;
  const max = Math.min(a.length, b.length);
  while (i < max && a[i] === b[i]) i++;
  return a.slice(0, i);
}

/**
 * The leading-whitespace prefix shared by every non-blank line in `lines`,
 * or "" when there is none (or every line is blank).
 */
function computeCommonIndent(lines: string[]): string {
  let common: string | null = null;
  for (const line of lines) {
    if (line.trim() === "") continue; // ignore whitespace-only lines
    const indent = leadingWhitespace(line);
    common = common === null ? indent : commonPrefix(common, indent);
    if (common === "") break;
  }
  return common ?? "";
}

export function dedentPythonCode(code: string): string {
  const lines = code.split("\n");
  const prefix = computeCommonIndent(lines);
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
