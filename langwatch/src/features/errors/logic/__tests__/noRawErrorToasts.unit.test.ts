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
import { readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const SRC_ROOT = fileURLToPath(new URL("../../../../", import.meta.url));

/**
 * `description:` fed directly from an error's `.message`, in any of the
 * shapes the codebase used: `error.message`, `err.message`, `e.message`,
 * `error.message || "…"`, `String(error)`.
 */
const RAW_MESSAGE_TOAST =
  /description:\s*(?:`?\$?\{?\s*)?(?:error|err|e)\s*(?:\?\.)?\.message/;

/**
 * Files allowed to reference an error message directly.
 *
 * Keep this list empty-ish and justified. It is not a place to park a
 * migration you didn't finish.
 */
const ALLOWED = new Set<string>([
  // The helper whose entire job is to read errors correctly.
  "features/errors/logic/showErrorToast.ts",
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

    for (const file of walk(SRC_ROOT)) {
      const rel = relative(SRC_ROOT, file);
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
        `one it can leak internals. Use showErrorToast(error, { fallbackTitle }) ` +
        `from ~/features/errors instead — see ` +
        `dev/docs/best_practices/error-handling.md.`,
    ).toEqual([]);
  });
});
