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

/** The copy slots a customer reads. */
const COPY_SLOT = /\b(?:title|description|fallbackTitle)\s*:\s*/g;

/**
 * Reads one property value, starting just after its `:`.
 *
 * A regex cannot do this correctly and two earlier versions of this guard
 * proved it. Bounding the value with `[^,;]` under-matched — it stopped at the
 * first comma, so `description: fmt("Couldn't save", error.message)` was
 * invisible — and over-matched, because with no comma or semicolon in the way
 * it ran off the end of the call into the next statement, so
 * `toast={{ title: "x" }}` followed by `onClick={() => log(error.message)}`
 * read as one value and would have been flagged.
 *
 * So: scan, tracking nesting and string state. The value ends at a `,` or `;`
 * at depth zero, or at the `}` that closes the object literal it lives in.
 * Strings and template literals are skipped whole, so a brace or comma inside
 * copy can't end the value early.
 */
function readValue(source: string, from: number): string {
  let depth = 0;
  let at = from;

  for (; at < source.length; at++) {
    const char = source[at]!;

    if (char === '"' || char === "'" || char === "`") {
      at = skipString(source, at);
      continue;
    }
    if (char === "(" || char === "[" || char === "{") depth++;
    else if (char === ")" || char === "]") {
      if (depth === 0) break;
      depth--;
    } else if (char === "}") {
      // Depth zero means this closes the object holding the property, so the
      // value ended here — this is what stops the scan escaping the call.
      if (depth === 0) break;
      depth--;
    } else if ((char === "," || char === ";") && depth === 0) break;
  }

  return source.slice(from, at);
}

/** Index of the closing quote of the string starting at `at`. */
function skipString(source: string, at: number): number {
  const quote = source[at];
  for (let scan = at + 1; scan < source.length; scan++) {
    if (source[scan] === "\\") {
      scan++;
      continue;
    }
    if (source[scan] === quote) return scan;
  }
  return source.length;
}

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

/**
 * `String(error)` — the other way to spell the same leak.
 *
 * The template alternative requires `.message` or `String(`, unlike an earlier
 * version which flagged any template opening `${e…}`. `e` is the near-universal
 * name for a map or event parameter, so ``title: `${e.label}` `` inside a
 * `.map((e) => …)` failed the guard with a message about leaking an error
 * message it had never read.
 */
const STRINGIFIES_ERROR =
  /String\(\s*(?:error|err|e|exception|cause)\s*\)|`[^`]*\$\{[^}]*\b(?:error|err|e|exception|cause)\b[^}]*\.\s*message\b/;

/**
 * Files allowed to reference an error message directly.
 *
 * Keep this list empty-ish and justified. It is not a place to park a
 * migration you didn't finish.
 */
const ALLOWED = new Set<string>([
  // This file. Its fixtures are deliberately written leaks — the detector's
  // own tests above assert each one is caught — so scanning itself would
  // always fail. Nothing else belongs here: `showErrorToast.ts` used to, but
  // its only `description: error.message` is inside a docblock, which
  // `stripComments` blanks, and an allowlist entry that isn't holding
  // anything back reads as permission to add more.
  "src/features/errors/logic/__tests__/noRawErrorToasts.unit.test.ts",
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
 *
 * A leading `*` is NOT treated as a comment. Block comments are already gone
 * by then, so the only lines left starting with one are code — a JSX required
 * marker (`ee/governance/dashboard/pages/ingestion-sources.tsx` has one), or a
 * wrapped multiplication. Blanking those deletes real punctuation and moves
 * the value boundaries the scanner depends on.
 */
function stripComments(source: string): string {
  const withoutBlocks = source.replace(/\/\*[\s\S]*?\*\//g, (block) =>
    block.replace(/[^\n]/g, " "),
  );

  return withoutBlocks
    .split("\n")
    .map((line) =>
      line.trimStart().startsWith("//") ? " ".repeat(line.length) : line,
    )
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

/** The detector, isolated from the filesystem walk so it can be tested. */
function leaksIn(source: string): boolean {
  const scanned = stripComments(source);
  for (const match of scanned.matchAll(COPY_SLOT)) {
    const value = readValue(scanned, match.index + match[0].length);
    if (
      (READS_MESSAGE.test(value) && ERROR_IDENTIFIER.test(value)) ||
      STRINGIFIES_ERROR.test(value)
    ) {
      return true;
    }
  }
  return false;
}

/**
 * The detector's own tests.
 *
 * Without these, "no offenders" is indistinguishable from "detects nothing" —
 * and this guard has twice shipped in the second state while reporting the
 * first. Every LEAKS case is a shape that reached a customer, or would have.
 */
describe("the raw-message detector", () => {
  describe("given a leak", () => {
    it.each([
      ["flat", `toaster.create({ description: error.message })`],
      ["in the title", `toaster.create({ title: error.message })`],
      ["as-cast", `toaster.create({ description: (error as Error).message })`],
      [
        "property-access cast",
        `toaster.create({ description: String((err as { message: unknown }).message) })`,
      ],
      [
        "wrapped onto the next line by the formatter",
        `toaster.create({\n  description:\n    err instanceof Error ? err.message : "x",\n})`,
      ],
      [
        "inside a template literal",
        "toaster.create({ description: `Failed: ${error.message}` })",
      ],
      [
        "behind a comma, inside a call",
        `toaster.create({ description: fmt("Couldn't save", error.message) })`,
      ],
      [
        "joined from an array",
        `toaster.create({ description: [prefix, error.message].join(" ") })`,
      ],
      [
        "in showErrorToast's own fallback",
        `showErrorToast({ error, fallbackTitle: error.message })`,
      ],
      ["stringified", `toaster.create({ description: String(error) })`],
    ])("catches it %s", (_shape, source) => {
      expect(leaksIn(source)).toBe(true);
    });
  });

  describe("given something that only looks like one", () => {
    it.each([
      [
        "a real message that isn't an error's",
        `toaster.create({ description: notification.message })`,
      ],
      ["plain copy", `toaster.create({ description: "Something went wrong" })`],
      [
        "a correct call",
        `showErrorToast({ error, fallbackTitle: "Couldn't save" })`,
      ],
      [
        "a map parameter named e",
        "items.map((e) => toaster.create({ title: `${e.label}` }))",
      ],
      [
        "an unrelated statement after the call",
        `toaster.create({ title: "Failed" })\nconsole.error(error.message)`,
      ],
      [
        "a JSX prop object followed by a handler",
        `<Toast toast={{ title: "x" }} onClick={() => log(error.message)} />`,
      ],
      [
        "the pattern described in a comment",
        `// never write description: error.message\ntoaster.create({ description: "ok" })`,
      ],
    ])("stays quiet about %s", (_shape, source) => {
      expect(leaksIn(source)).toBe(false);
    });
  });
});

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

      for (const match of source.matchAll(COPY_SLOT)) {
        const value = readValue(source, match.index + match[0].length);
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
