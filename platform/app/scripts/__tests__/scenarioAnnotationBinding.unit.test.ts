// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

/**
 * @vitest-environment node
 *
 * An annotation that binds nothing and says nothing about it.
 *
 * The parity checker has three verdicts an author can see. A scenario with no
 * test is reported unbound. An annotation naming no scenario is reported
 * unknown. Both fail the run and both name the file. There is a fourth, and it
 * is silent: an annotation the extractor reads correctly, whose title is
 * perfectly good, which never reaches the binding table because the walk that
 * looks for the test call could not find one. `collectAllBindings` drops it
 * with a bare `continue`. No count, no file, no diagnostic.
 *
 * That is worse than an unbound scenario, because an unbound scenario is a
 * gap somebody is told about. This is a gap that reads as coverage. The test
 * runs, passes, and appears bound to a requirement that has no record of it.
 *
 * IT HAS ALREADY HAPPENED HERE. A privacy guard was written because a leak of
 * that exact shape reached production. Its third annotation sat on the second
 * line of a long comment block, and bound to nothing for as long as it
 * existed. The suite was green, parity was green, and the requirement had no
 * test against its name. That file is the fixture at the bottom of this
 * file — not a reconstruction of the shape, the artefact itself.
 *
 * WHY THIS IMPORTS THE PREDICATE RATHER THAN RESTATING IT. The acceptance rule
 * is extraction AND proximity. A guard that copies either half agrees with
 * itself and measures a question nobody asked; the first attempt at this guard
 * copied the extraction regex, passed its own mutation, and sat in a file that
 * contained a real unbound annotation the whole time. So both halves come from
 * the checker by import, and if the checker's rule changes this guard changes
 * with it or fails loudly.
 */
import { readdirSync, readFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import {
  findScenarioAnnotations,
  isFollowedByTestCall,
} from "../check-feature-parity";

const HERE = dirname(fileURLToPath(import.meta.url));
const APP_ROOT = resolve(HERE, "../..");

/**
 * The trees this session owns.
 *
 * Deliberately not the whole repository. A guard that walks everything runs on
 * every unrelated change and reports other people's debt as this suite's
 * failure, which is how a guard gets deleted rather than fixed. These are the
 * directories where the governance work lives and where the real instance was
 * found.
 *
 * WHAT A GREEN RUN HERE DOES NOT MEAN. Running this same predicate over the
 * whole app at the time of writing returned 98 dangling annotations across
 * 3,582 test files, none of them under these three trees. A second session
 * measured the same population with a blunter instrument and got 113, which it
 * withdrew as an upper bound once it found a prose fragment among its titles.
 * Either way the order is the same and the debt is real.
 *
 * Some of it is not hygiene. These four requirements had a passing test and
 * nothing bound to them:
 *
 *   - "Cross-tenant event_log read is structurally denied"
 *   - "An api key's ceiling cannot be dropped by its caller"
 *   - "A pass that loses the marker publishes neither the count nor the drift"
 *   - "Migration never silently drops a concurrent write"
 *
 * They are recorded here rather than fixed because widening this guard to
 * cover them lands it red on 98 offenders, and a guard that is red on arrival
 * gets its scope cut instead of its findings fixed — which would leave the
 * narrow case certified forever and the wide one silent again. The scope is a
 * deliberate limit, not a claim about the rest of the repository.
 */
const SCANNED_TREES = [
  "ee/governance",
  "src/components/governance",
  "src/pages/governance",
];

const TEST_FILE_RE = /\.(?:unit|integration|e2e)\.test\.tsx?$/;

/** Every test file under the scanned trees, as absolute paths. */
function scannedTestFiles(): string[] {
  const out: string[] = [];

  function walk(dir: string): void {
    // A tree that does not exist is not a failure of this guard.
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const name = String(entry.name);
      const full = resolve(dir, name);
      if (entry.isDirectory()) {
        if (name === "node_modules") continue;
        walk(full);
        continue;
      }
      if (TEST_FILE_RE.test(name)) out.push(full);
    }
  }

  for (const tree of SCANNED_TREES) walk(resolve(APP_ROOT, tree));
  return out;
}

/**
 * Annotations the checker reads and then silently discards.
 *
 * This is `collectAllBindings`' own loop with the `continue` inverted: it
 * collects exactly what that function throws away.
 */
function danglingAnnotations(
  source: string,
): { title: string; line: number }[] {
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

describe("scenario annotations that bind nothing, in the governance trees", () => {
  it("does not let a governance annotation go nowhere without saying so", () => {
    const files = scannedTestFiles();

    // A zero from an empty walk proves nothing, and this guard's whole
    // complaint is about silent nothings. If the trees move, fail here rather
    // than pass on an empty set.
    expect(files.length).toBeGreaterThan(50);

    const offenders: string[] = [];
    for (const file of files) {
      const source = readFileSync(file, "utf8");
      for (const dangling of danglingAnnotations(source)) {
        offenders.push(
          `${relative(APP_ROOT, file)}:${dangling.line} — @scenario ${JSON.stringify(dangling.title)}`,
        );
      }
    }

    expect(
      offenders,
      [
        "These annotations are read by the parity checker and then dropped without a diagnostic.",
        "Each one looks like coverage and is not: the scenario it names has no test bound to it,",
        "and the parity run stays green because a dropped annotation is reported nowhere.",
        "",
        "The fix is always the same: the annotation must CLOSE its own comment.",
        '  /** @scenario "Some title" */',
        '  it("...", () => {})',
        "",
        "Moving it to the FIRST line of a long block does not work. The walk that looks for",
        "the test call starts immediately after the annotation and cannot get out of a comment",
        "it begins inside, so it lands on the prose below and gives up.",
        "",
        offenders.join("\n"),
      ].join("\n"),
    ).toEqual([]);
  });

  /**
   * The reproduction, kept verbatim.
   *
   * Three annotations. Two close their own comment and bind. The third opens
   * the second line of a block comment whose prose runs on below it, and binds
   * nothing — which is how it shipped, and why the requirement it names went
   * untested while everything was green.
   *
   * This fixture is what makes the guard above meaningful. Without a case that
   * fails, "zero offenders" is indistinguishable from a walk that found no
   * files, a predicate that always returns true, or an extractor that reads
   * nothing.
   */
  it("catches the annotation that actually shipped unbound", () => {
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

    // The checker binds two of them. The third is the silent one.
    expect(danglingAnnotations(shipped)).toEqual([
      { title: "The erasure count never rides a span", line: 8 },
    ]);
  });

  it("binds an annotation that closes its comment, however long the comment above it", () => {
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
