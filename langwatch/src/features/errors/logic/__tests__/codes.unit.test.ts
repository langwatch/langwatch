/**
 * Keeps `APP_ERROR_CODES` honest against the code actually raising errors.
 *
 * The presentation registry is exhaustive over `AppErrorCode`, so that union is
 * what forces every error code to have customer-facing copy. A hand-maintained
 * list only holds that line if something notices when it drifts — TypeScript
 * can't, because there is no way to reflect over "every subclass of
 * HandledError in the program".
 *
 * So: scan the source for every code a `HandledError` subclass declares, and
 * fail on a mismatch in EITHER direction.
 *
 *   - a code raised but not listed  → an error with no copy would reach a user
 *   - a code listed but not raised  → dead copy, which is how the automations
 *     explainer ended up with a `recipient_not_in_team` branch for a code
 *     nothing throws
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { APP_ERROR_CODES } from "../codes";

const PACKAGE_ROOT = fileURLToPath(new URL("../../../../../", import.meta.url));

/**
 * Every tree that raises a handled error, the same three the raw-toast guard
 * walks (`noRawErrorToasts.unit.test.ts`).
 *
 * `src` alone was a hole with no symptom: `ee/admin/impersonation.service.ts`
 * declares three codes and `packages/api` another, so none of the four entered
 * `APP_ERROR_CODES`, none was required to have copy, and the exhaustive
 * `satisfies` in `presentation.ts` had nothing to complain about. A guard that
 * only looks where the codes already are is a guard that passes forever.
 */
const ROOTS = ["src", "ee", "packages"].map((dir) => join(PACKAGE_ROOT, dir));

/**
 * Codes the ROOT workspace package raises rather than an app-level subclass, so
 * no amount of scanning the trees above will find their declaration —
 * `@langwatch/handled-error` lives outside `langwatch/`.
 */
const PACKAGE_OWNED_CODES = new Set(["validation_error"]);

/**
 * A path typo turns this whole guard into a no-op, and it reports that as a
 * pass. The exact number is noise, but "we read thousands of files" and "we
 * read none" are worlds apart, and only one of them is a working guard.
 */
const MINIMUM_SCANNED_FILES = 500;

/**
 * The four shapes a code is declared in:
 *   `super("some_code", …)`                    — the common case
 *   `declare readonly code: "some_code"`        — subclass narrowing
 *   `const { code = "some_code" } = options`    — a base class's default
 *   `new HandledError("some_code", …)`          — a one-off with no subclass
 *
 * The last is worth scanning even though subclasses are the norm: a single
 * permission denial doesn't earn a class, and a shape the scanner can't see is
 * a code that reaches a customer with no copy written for it.
 */
const CODE_PATTERNS = [
  /super\(\s*"([a-z][a-z0-9_]*)"/g,
  /declare\s+(?:readonly\s+)?code:\s*"([a-z][a-z0-9_]*)"/g,
  /\bcode\s*=\s*"([a-z][a-z0-9_]*)"/g,
  /new\s+HandledError\(\s*"([a-z][a-z0-9_]*)"/g,
];

function isTestFile(path: string): boolean {
  return path.includes("__tests__") || /\.test\.tsx?$/.test(path);
}

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules") continue;
      walk(path, out);
    } else if (/\.tsx?$/.test(entry.name) && !isTestFile(path)) {
      out.push(path);
    }
  }
  return out;
}

function scannedFiles(): string[] {
  return ROOTS.flatMap((root) => walk(root));
}

function declaredCodes(): Set<string> {
  const found = new Set<string>();
  for (const file of scannedFiles()) {
    const source = readFileSync(file, "utf8");
    // Only files that actually deal in handled errors — `super("...")` is far
    // too common a shape to scan blind.
    if (!source.includes("@langwatch/handled-error")) continue;
    for (const pattern of CODE_PATTERNS) {
      for (const match of source.matchAll(pattern)) {
        if (match[1]) found.add(match[1]);
      }
    }
  }
  return found;
}

describe("APP_ERROR_CODES", () => {
  describe("given the trees the guard walks", () => {
    it("reads a whole codebase, not an empty directory", () => {
      expect(
        scannedFiles().length,
        `The walk found almost nothing, so every assertion below passes ` +
          `vacuously. Check the roots resolve: ${ROOTS.join(", ")}.`,
      ).toBeGreaterThan(MINIMUM_SCANNED_FILES);
    });
  });

  describe("given the codes the source actually declares", () => {
    it("lists every code a HandledError subclass raises", () => {
      const listed = new Set<string>(APP_ERROR_CODES);
      const missing = [...declaredCodes()].filter((code) => !listed.has(code));

      expect(
        missing,
        `These handled-error codes are raised but missing from APP_ERROR_CODES, so ` +
          `no customer-facing copy is required for them. Add them to codes.ts and ` +
          `write their entry in presentation.ts.`,
      ).toEqual([]);
    });

    it("lists no code that nothing raises", () => {
      const declared = declaredCodes();
      const orphans = APP_ERROR_CODES.filter(
        (code) => !declared.has(code) && !PACKAGE_OWNED_CODES.has(code),
      );

      expect(
        orphans,
        `These codes are in APP_ERROR_CODES but nothing raises them — the copy ` +
          `written for them is dead. Remove them, or find out why the error that ` +
          `used to throw them stopped.`,
      ).toEqual([]);
    });
  });

  it("holds no duplicates", () => {
    expect(APP_ERROR_CODES.length).toBe(new Set(APP_ERROR_CODES).size);
  });

  it("stays sorted, so a hand edit lands where the reader looks for it", () => {
    // Not a value echo — this asserts an invariant of the list's arrangement,
    // not its contents. The list is hand-maintained and every new code is an
    // insertion into it; once the order breaks, the next person inserts by
    // eye near the wrong neighbour and duplicates become easy to miss.
    expect([...APP_ERROR_CODES]).toEqual([...APP_ERROR_CODES].sort());
  });
});
