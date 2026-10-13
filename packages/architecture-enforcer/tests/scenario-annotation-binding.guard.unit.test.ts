/**
 * @vitest-environment node
 * Guards a silent failure: an annotation that extracts fine but has no
 * nearby test call is dropped with no diagnostic, reading as bound coverage.
 */
import { readdirSync, readFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  findScenarioAnnotations,
  isFollowedByTestCall,
} from "../src/tools/check-feature-parity.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const APP_ROOT = resolve(HERE, "../../..");

/**
 * Every tree that can hold a test file. Deliberately not scoped to a few
 * governance directories — a scoped walk reports zero everywhere it doesn't
 * look, so a new dangling annotation outside that scope never fails.
 */
const ROOTS = ["apps", "modules", "enterprise", "packages", "tools", "mcp", "sdks/typescript"];

const TEST_FILE_RE = /\.test\.[cm]?[jt]sx?$/;

/**
 * Below this many scanned files, assume the walk broke rather than that the
 * repository lost its tests (roughly 5,300 match today). A zero from an
 * empty walk proves nothing — the same defect as a guard with no files to read.
 */
const SCANNED_FILE_FLOOR = 2_000;

/** Every test file under {@link ROOTS}, as absolute paths. */
function scannedTestFiles(): string[] {
  const out: string[] = [];

  function walk(dir: string): void {
    // A tree that does not exist is not a failure of this guard. Anything
    // else is: a directory this walk could not read is a directory whose
    // annotations went unchecked, and swallowing it would leave the file count
    // above its floor while the guard silently stopped looking. The floor
    // catches a walk that found nothing, not one that skipped a subtree.
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch (error) {
      const code = (error as { code?: string }).code;
      if (code === "ENOENT" || code === "ENOTDIR") return;
      throw error;
    }
    for (const entry of entries) {
      const name = String(entry.name);
      const full = resolve(dir, name);
      if (entry.isDirectory()) {
        if (["node_modules", ".next", "dist", "platform"].includes(name)) {
          continue;
        }
        walk(full);
        continue;
      }
      if (TEST_FILE_RE.test(name)) out.push(full);
    }
  }

  for (const root of ROOTS) walk(resolve(APP_ROOT, root));
  return out;
}

/**
 * Annotations the checker reads and then silently discards — this is
 * `collectAllBindings`'s own loop with the `continue` inverted, collecting
 * exactly what that function throws away.
 */
function danglingAnnotations(source: string): { title: string; line: number }[] {
  const dangling: { title: string; line: number }[] = [];
  for (const annotation of findScenarioAnnotations(source)) {
    if (isFollowedByTestCall(source, annotation.end)) continue;
    dangling.push({
      title: annotation.title,
      line: source.slice(0, annotation.index).split("\n").length,
    });
  }
  return dangling;
}

describe("given the parity checker drops an annotation it cannot bind", () => {
  describe("when every test file in the repository is walked", () => {
    it("finds no annotation the checker would drop", () => {
      const files = scannedTestFiles();

      expect(files.length).toBeGreaterThan(SCANNED_FILE_FLOOR);

      /** Actual dangling count per file, and the offenders for the message. */
      const counts: Record<string, number> = {};
      const detail: string[] = [];

      for (const file of files) {
        const source = readFileSync(file, "utf8");
        const dangling = danglingAnnotations(source);
        if (dangling.length === 0) continue;

        const path = relative(APP_ROOT, file).split("\\").join("/");
        counts[path] = dangling.length;
        for (const one of dangling) {
          detail.push(`${path}:${one.line} — @scenario ${JSON.stringify(one.title)}`);
        }
      }

      expect(
        counts,
        [
          "A @scenario annotation the parity checker would drop.",
          "",
          "A @scenario annotation here is read by the parity checker and then dropped",
          "without a diagnostic. It looks like coverage and is not: the scenario it names",
          "has no test bound to it, and the parity run stays green because a dropped",
          "annotation is reported nowhere.",
          "",
          "Fix each one: put the annotation directly above the test call it names,",
          '  /** @scenario "Some title" */',
          '  it("...", () => {})',
          "",
          "Every dangling annotation currently found:",
          detail.join("\n"),
        ].join("\n"),
      ).toEqual({});
    });
  });

  describe("when the annotation sits inside a block whose prose runs on below it", () => {
    /** The reproduction, kept verbatim: the third annotation opens a block whose prose runs on. */
    it("binds the annotation that once shipped unbound", () => {
      const shipped = [
        '    /** @scenario "An operator-only HTTP status never reaches a customer" */',
        '    it("keeps the status off a customer row", () => {});',
        "",
        '    /** @scenario "The mirror carries no sensitive value onto a customer row" */',
        '    it("keeps the mirror clean", () => {});',
        "",
        "    /**",
        '     * @scenario "The erasure count never rides a span"',
        "     *",
        "     * The span attributes are the one place a count can leave without a",
        "     * reader asking for it, which is how the original leak travelled, and",
        "     * this prose is exactly what stops the walk below from ever reaching",
        "     * the test call underneath it.",
        "     */",
        '    it("keeps the count off every span", () => {});',
      ].join("\n");

      // The extractor sees all three. This is the half a copied-regex guard
      // measures, and it is why that guard passed while the file was broken.
      expect(findScenarioAnnotations(shipped).map((a) => a.title)).toEqual([
        "An operator-only HTTP status never reaches a customer",
        "The mirror carries no sensitive value onto a customer row",
        "The erasure count never rides a span",
      ]);

      // The checker now steps over the rest of the block, so all three bind.
      expect(danglingAnnotations(shipped)).toEqual([]);
    });
  });

  describe("when the annotation closes its own comment", () => {
    it("binds it however long the comment above it runs", () => {
      // The distinguishing property is the CLOSE, not the length and not the
      // position. A long block is fine as long as the annotation terminates it.
      const fixed = [
        "    /**",
        "     * A great deal of prose about why this test exists, running on for",
        "     * as long as it needs to, none of which affects the binding.",
        "     */",
        '    /** @scenario "The erasure count never rides a span" */',
        '    it("keeps the count off every span", () => {});',
      ].join("\n");

      expect(danglingAnnotations(fixed)).toEqual([]);
    });
  });
});
