import { execSync } from "child_process";

/**
 * Matches a file path against a glob pattern.
 *
 * Supported syntax:
 * - `**` matches any number of path segments (including zero)
 * - `*` matches any characters within a single segment (not `/`)
 *
 * No npm dependencies -- pure regex conversion.
 */
export function matchGlob(filePath: string, pattern: string): boolean {
  // Tokenize the pattern to distinguish ** from * and literal segments
  const parts: string[] = [];
  let i = 0;
  while (i < pattern.length) {
    if (pattern[i] === "*" && pattern[i + 1] === "*") {
      parts.push("**");
      i += 2;
    } else if (pattern[i] === "*") {
      parts.push("*");
      i += 1;
    } else {
      let literal = "";
      while (i < pattern.length && pattern[i] !== "*") {
        literal += pattern[i];
        i += 1;
      }
      parts.push(literal);
    }
  }

  // Build regex from tokenized parts
  let regex = "^";
  for (const part of parts) {
    if (part === "**") {
      regex += ".*";
    } else if (part === "*") {
      regex += "[^/]*";
    } else {
      regex += part.replace(/[.+?^${}()|[\]\\]/g, "\\$&");
    }
  }
  regex += "$";

  return new RegExp(regex).test(filePath);
}

/**
 * Returns the list of files changed on the current branch relative to a base branch.
 *
 * Uses `git diff --name-only <baseBranch>...HEAD`.
 * Base branch defaults to `EVALS_BASE` env var, falling back to the provided parameter.
 */
export function getChangedFiles(baseBranch: string = "main"): string[] {
  const base = process.env.EVALS_BASE ?? baseBranch;
  try {
    const output = execSync(`git diff --name-only ${base}...HEAD`, {
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
    });
    return output
      .trim()
      .split("\n")
      .filter((line) => line.length > 0);
  } catch {
    // If git diff fails (e.g. base branch not found), return empty
    return [];
  }
}

/**
 * Selects tests whose dependencies overlap with the changed files.
 *
 * - If any changed file matches a global touchfile pattern, ALL tests are returned.
 * - Otherwise, a test is included if any of its touchfile patterns match any changed file.
 * - Returns a sorted list of test names.
 */
export function selectTests(
  changedFiles: string[],
  touchfiles: Record<string, string[]>,
  globalTouchfiles: string[]
): string[] {
  if (changedFiles.length === 0) {
    return [];
  }

  // Check global touchfiles first
  const globalTriggered = changedFiles.some((file) =>
    globalTouchfiles.some((pattern) => matchGlob(file, pattern))
  );

  if (globalTriggered) {
    return Object.keys(touchfiles).sort();
  }

  // Check per-test touchfiles
  const selected: string[] = [];
  for (const [testName, patterns] of Object.entries(touchfiles)) {
    const isAffected = changedFiles.some((file) =>
      patterns.some((pattern) => matchGlob(file, pattern))
    );
    if (isAffected) {
      selected.push(testName);
    }
  }

  return selected.sort();
}

/**
 * Builds a vitest `--grep` regex pattern from selected test names.
 *
 * Returns `undefined` when no tests are selected (caller should skip the run).
 *
 * Special regex characters in test names are escaped so the pattern
 * matches the literal test description.
 */
export function buildGrepPattern(selectedTests: string[]): string | undefined {
  if (selectedTests.length === 0) {
    return undefined;
  }

  const escaped = selectedTests.map((name) =>
    name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
  );

  // Use alternation to match any of the selected tests
  return escaped.join("|");
}
