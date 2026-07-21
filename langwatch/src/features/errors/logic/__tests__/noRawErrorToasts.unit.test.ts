/**
 * Stops the 105 raw-message error toasts from growing back.
 *
 * `toaster.create({ description: error.message })` is the obvious thing to
 * write and it is wrong: since #5984 the wire message for a handled error is
 * its code, so this renders `validation_error` at a customer, and for an
 * unhandled error the message can carry internals. `showErrorToast` exists to
 * be the one correct way to do this.
 *
 * A type can't catch it — `error.message` is a perfectly good string — so it
 * is caught here instead, the same way `codes.unit.test.ts` catches an
 * unregistered code.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const PACKAGE_ROOT = fileURLToPath(new URL("../../../../../", import.meta.url));

/**
 * Both trees that ship UI. `ee/` was outside the original walk, so fourteen
 * raw-message toasts in the governance and backoffice dashboards were never
 * caught — the guard has to cover everywhere the pattern can appear, not just
 * where the migration happened to look.
 */
const ROOTS = ["src", "ee"].map((dir) => join(PACKAGE_ROOT, dir));

/**
 * An error's `.message` fed into either toast field.
 *
 * `title:` matters as much as `description:` — the wire message for a handled
 * error IS the code, so `title: error.message` puts `validation_error` in the
 * headline, which is worse than putting it in the body. The first version of
 * this guard only checked `description:` and eleven title-slug toasts sailed
 * through it.
 *
 * Covers `error.message`, `err?.message`, `e.message || "…"` and
 * `String(error)`. Scanned against the whole file rather than line-by-line so
 * a wrapped `description:\n  error.message` can't hide.
 */
const RAW_MESSAGE_TOAST =
  /(?:title|description|fallbackTitle)\s*:\s*[^,\n}]*(?:\b(?:error|err|e)\s*\??\.\s*message\b|String\(\s*(?:error|err|e)\s*\))/;

/**
 * Files allowed to reference an error message directly.
 *
 * Keep this list empty-ish and justified. It is not a place to park a
 * migration you didn't finish.
 */
const ALLOWED = new Set<string>([
  // The helper whose entire job is to read errors correctly.
  "src/features/errors/logic/showErrorToast.ts",
]);

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules") continue;
      walk(path, out);
    } else if (/\.tsx?$/.test(entry.name)) {
      out.push(path);
    }
  }
  return out;
}

describe("error toasts", () => {
  it("never render an error's raw message", () => {
    const offenders: string[] = [];

    for (const file of ROOTS.flatMap((root) => walk(root))) {
      const rel = relative(PACKAGE_ROOT, file);
      if (ALLOWED.has(rel)) continue;

      const source = readFileSync(file, "utf8");
      if (!source.includes("toaster")) continue;

      source.split("\n").forEach((line, index) => {
        // Comments describing the pattern (this file's own docblock, the
        // best-practices examples) are not call sites.
        const trimmed = line.trim();
        if (trimmed.startsWith("*") || trimmed.startsWith("//")) return;

        if (RAW_MESSAGE_TOAST.test(line)) {
          offenders.push(`${rel}:${index + 1}`);
        }
      });
    }

    expect(
      offenders,
      `These toasts render an error's raw message. For a handled error that is ` +
        `the code slug (the customer reads "validation_error"); for an unhandled ` +
        `one it can leak internals. Use showErrorToast({ error, fallbackTitle }) ` +
        `from ~/features/errors instead — see ` +
        `dev/docs/best_practices/error-handling.md.`,
    ).toEqual([]);
  });
});
