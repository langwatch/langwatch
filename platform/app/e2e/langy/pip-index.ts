/**
 * What the package index offers one interpreter, read off `pip index versions`.
 *
 * A scenario whose premise is "pip cannot reach a usable SDK on this python"
 * has to ask the index rather than trust a version number, because the premise
 * dies the day a release ships that accepts the interpreter. Asking is only
 * useful if the answer is read correctly: a probe that cannot parse pip's
 * output returns nothing, and nothing reads exactly like a dead premise.
 */

import { execFileSync } from "node:child_process";

/**
 * The newest version in one `pip index versions <package>` output, or null.
 *
 * Three shapes, and the environment decides which arrives. `INSTALLED:` and
 * `LATEST:` are printed only when the package is already installed, which in
 * a venv built for a scenario it never is. What always comes is the header
 * line, `langwatch (0.1.32)`, and the list under it, newest first.
 */
export function parseReachableVersion({
  output,
  name,
}: {
  output: string;
  name: string;
}): string | null {
  const latest = /^\s*LATEST:\s*(.+)$/m.exec(output)?.[1]?.trim();
  if (latest) return latest;
  const header = new RegExp(`^\\s*${name}\\s*\\(([^)]+)\\)\\s*$`, "m")
    .exec(output)?.[1]
    ?.trim();
  if (header) return header;
  const available = /^\s*Available versions:\s*(.+)$/m
    .exec(output)?.[1]
    ?.split(",")[0]
    ?.trim();
  return available || null;
}

/** The newest version of `name` the index offers `python`, or null. */
export function reachableVersion({
  python,
  name,
}: {
  python: string;
  name: string;
}): string | null {
  try {
    const output = execFileSync(
      python,
      ["-m", "pip", "index", "versions", name],
      {
        encoding: "utf8",
        timeout: 120_000,
      },
    );
    return parseReachableVersion({ output, name });
  } catch {
    return null;
  }
}

/** The version of `name` an interpreter has installed, or null when it has none. */
export function installedVersion({
  python,
  name,
}: {
  python: string;
  name: string;
}): string | null {
  try {
    const shown = execFileSync(python, ["-m", "pip", "show", name], {
      encoding: "utf8",
      timeout: 120_000,
    });
    return /^Version:\s*(.+)$/m.exec(shown)?.[1]?.trim() ?? null;
  } catch {
    return null;
  }
}

/** Whether `version` sorts before `floor`, comparing numbers not text. */
export function belowVersion(version: string, floor: string): boolean {
  const parts = (value: string) => value.split(".").map(Number);
  const [left, right] = [parts(version), parts(floor)];
  for (let index = 0; index < Math.max(left.length, right.length); index++) {
    const a = left[index] ?? 0;
    const b = right[index] ?? 0;
    if (a !== b) return a < b;
  }
  return false;
}
