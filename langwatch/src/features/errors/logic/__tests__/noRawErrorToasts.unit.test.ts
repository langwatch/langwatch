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
 * A toast copy slot and everything up to the end of its value.
 *
 * `title:` matters as much as `description:` — the wire message for a handled
 * error IS the code, so `title: error.message` puts `validation_error` in the
 * headline, which is worse than putting it in the body. The first version of
 * this guard only checked `description:` and eleven title-slug toasts sailed
 * through it.
 *
 * The value deliberately spans newlines. The formatter wraps almost every real
 * call site onto a second line (`description:\n  err instanceof Error ? …`),
 * and an earlier version of this guard tested each physical line in isolation,
 * so every wrapped site was invisible to it — which is how the sites listed in
 * `ALLOWED`'s history got through a migration that was supposed to catch them.
 *
 * Bounded by `,` and `;` rather than by `}`: the value can legitimately
 * contain braces (`(err as { message: unknown }).message`), while a semicolon
 * always means the statement ended and we have run off into unrelated code.
 */
const TOAST_COPY_VALUE =
  /(?:title|description|fallbackTitle)\s*:\s*([^,;]{0,300}?)(?=[,;]|$)/g;

/** `.message` read off anything, however it is spelled. */
const READS_MESSAGE = /\?\s*\.\s*message\b|\.\s*message\b/;

/**
 * An error-shaped identifier anywhere in the value.
 *
 * Paired with {@link READS_MESSAGE} rather than glued to it, because the two
 * are routinely separated by a cast or a guard — `(error as Error).message`,
 * `(err as { message: unknown }).message`, `err instanceof Error ? err.message
 * : "…"`. Requiring them to be adjacent is what let those three shapes through;
 * requiring only that both appear keeps `description: notification.message`
 * (a real message, not an error's) out of the net.
 */
const ERROR_IDENTIFIER = /\b(?:error|err|e|exception|cause|reason)\b/;

/** `String(error)` — the other way to spell the same leak. */
const STRINGIFIES_ERROR =
  /String\(\s*(?:error|err|e|exception|cause)\s*\)|`[^`]*\$\{\s*(?:error|err|e)\b/;

/**
 * Files allowed to reference an error message directly.
 *
 * Keep this list empty-ish and justified. It is not a place to park a
 * migration you didn't finish.
 */
const ALLOWED = new Set<string>([
  // Deliberately empty. `showErrorToast.ts` used to sit here, but its only
  // `description: error.message` is inside a docblock, which `stripComments`
  // now blanks — an allowlist entry that isn't holding anything back reads as
  // permission to add more.
]);

/**
 * Blanks out comments so prose about the pattern isn't mistaken for a call
 * site, without moving anything: every stripped character becomes a space and
 * every newline survives, so match offsets still map to real line numbers.
 *
 * Line comments are only stripped when the line is *entirely* a comment. A
 * trailing `//` is left alone deliberately — stripping it would also eat the
 * `//` in a `https://` inside a string literal, and blinding the guard is a
 * worse failure than reading one comment too many.
 */
function stripComments(source: string): string {
  const withoutBlocks = source.replace(/\/\*[\s\S]*?\*\//g, (block) =>
    block.replace(/[^\n]/g, " "),
  );

  return withoutBlocks
    .split("\n")
    .map((line) => {
      const trimmed = line.trimStart();
      return trimmed.startsWith("//") || trimmed.startsWith("*")
        ? " ".repeat(line.length)
        : line;
    })
    .join("\n");
}

function lineOf(source: string, index: number): number {
  let line = 1;
  for (let at = 0; at < index; at++) if (source[at] === "\n") line++;
  return line;
}

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

      const raw = readFileSync(file, "utf8");
      // `showErrorToast` does not contain the substring "toaster", so testing
      // for "toaster" alone skipped every file that had already migrated —
      // exactly the files where `fallbackTitle: error.message` can appear.
      if (!/toaster|showErrorToast|HandledErrorAlert/.test(raw)) continue;

      const source = stripComments(raw);

      for (const match of source.matchAll(TOAST_COPY_VALUE)) {
        const value = match[1] ?? "";
        const leaks =
          (READS_MESSAGE.test(value) && ERROR_IDENTIFIER.test(value)) ||
          STRINGIFIES_ERROR.test(value);
        if (!leaks) continue;

        offenders.push(`${rel}:${lineOf(source, match.index)}`);
      }
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
