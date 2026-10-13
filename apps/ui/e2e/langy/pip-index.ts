/**
 * What the package index offers one interpreter. See README.md "Scenario
 * notes" (pip-index.ts) for why this asks rather than trusts a version.
 */

import { execFileSync } from "node:child_process";

/**
 * The newest version in one `pip index versions <package>` output, or null.
 * See README.md "Scenario notes" (pip-index.ts) for the three shapes.
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
  const header = new RegExp(`^\\s*${name}\\s*\\(([^)]+)\\)\\s*$`, "m").exec(output)?.[1]?.trim();
  if (header) return header;
  const available = /^\s*Available versions:\s*(.+)$/m.exec(output)?.[1]?.split(",")[0]?.trim();
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
    const output = execFileSync(python, ["-m", "pip", "index", "versions", name], {
      encoding: "utf8",
      timeout: 120_000,
    });
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
