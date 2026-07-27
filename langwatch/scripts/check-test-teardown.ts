#!/usr/bin/env tsx
/**
 * Teardown-safety check: no test file may call `deleteMany` filtered by a
 * reassignable (`let`/`var`) variable, or with no filter at all.
 *
 * Why: Prisma drops `undefined` from a where clause rather than matching
 * nothing, so `deleteMany({ where: { id: teamId } })` with `teamId` never
 * assigned (a `beforeAll` that threw first) is `deleteMany({})`, deleting
 * every row in the shared local test database. TypeScript cannot flag it:
 * definite-assignment analysis stops at the callback boundary. See #6219.
 *
 * The fix at the call site is `cleanupTestRows` from
 * `src/test-utils/cleanupTestRows.ts`, which refuses unidentifiable
 * filters loudly, or a module-level `const` id, which cannot be
 * undefined.
 *
 * The rule itself lives in `src/test-utils/teardownScan.ts` and is pinned
 * by a unit test, so this gate cannot quietly stop checking (#6169).
 *
 * Usage:
 *   pnpm check:test-teardown           # exit 1 on any violation
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { scanTestSourceForUnsafeDeleteMany } from "../src/test-utils/teardownScan";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const LANGWATCH_ROOT = resolve(__dirname, "..");

/** Same roots vitest collects test files from. */
const TEST_ROOTS = ["src", "ee", "packages"];

const TEST_FILE_PATTERN = /\.(test|spec)\.(c|m)?[jt]sx?$/;

function collectTestFiles(root: string): string[] {
  const collected: string[] = [];
  const walk = (directory: string): void => {
    let names: string[];
    try {
      names = readdirSync(directory);
    } catch {
      return;
    }
    for (const name of names) {
      if (name === "node_modules" || name.startsWith(".")) continue;
      const full = join(directory, name);
      const stats = statSync(full);
      if (stats.isDirectory()) {
        walk(full);
      } else if (TEST_FILE_PATTERN.test(name)) {
        collected.push(full);
      }
    }
  };
  walk(root);
  return collected;
}

function main(): void {
  const files = TEST_ROOTS.flatMap((root) =>
    collectTestFiles(resolve(LANGWATCH_ROOT, root)),
  );

  let violationCount = 0;
  for (const file of files) {
    const violations = scanTestSourceForUnsafeDeleteMany(
      file,
      readFileSync(file, "utf8"),
    );
    for (const violation of violations) {
      violationCount += 1;
      console.error(
        `✗ ${relative(LANGWATCH_ROOT, file)}:${violation.line} ` +
          `${violation.model}.deleteMany filtered by "${violation.variable}"\n` +
          `    ${violation.reason}\n` +
          "    Route the teardown through cleanupTestRows " +
          "(src/test-utils/cleanupTestRows.ts) or use a module-level const id.",
      );
    }
  }

  if (violationCount > 0) {
    console.error(
      `\nFAIL: ${violationCount} unsafe deleteMany call(s) in test files. ` +
        "A let-declared id is undefined when setup throws before assigning " +
        "it, and Prisma then deletes every row in the table (#6219).",
    );
    process.exit(1);
  }

  console.log(
    `OK: no unsafe deleteMany filters across ${files.length} test file(s).`,
  );
}

main();
