import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

// #721 / ADR-046: "recover via event replay" is FALSE for reactors, and that
// premise re-justified this module's silent drop from six places before it was
// caught. This guard fails if the claim reappears in the queue module WITHOUT a
// caveat scoping it to fold/map (or denying it for reactors). A guard that cannot
// disagree with its target is worthless, so the second test plants a violation and
// requires the guard to catch it — and requires a correctly-caveated line to pass.

const MODULE_DIR = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

/** The false premise, in any of its phrasings. */
const CLAIM = /recover(s|able|ed)?\b[^\n]{0,24}\bvia\b[^\n]{0,24}(event\s+)?replay/i;
/**
 * Tokens that genuinely SCOPE or DENY the claim on the SAME line. Deliberately
 * NOT `reactor` (a claim stated affirmatively *about* a reactor is the single most
 * dangerous case — ADR-046) and NOT a bare `only` (an unrelated "only high-priority
 * jobs" must not silence it). Every real correction site in this module carries one
 * of these on the same line as the claim, so a same-line check needs no ±1 window —
 * which is what let an unrelated `not`/`only` on an adjacent line create a
 * false-negative (hygiene review, PR #5853).
 */
const CAVEAT =
  /\bnot\b|\bnever\b|used to|n['’]t|adr-046|permanent loss|fold\/map|justified|once claimed/i;

/** Lines that ASSERT replay recovers a drop, with no scoping/denying caveat on the same line. */
export function replayClaimViolations(source: string): string[] {
  return source
    .split("\n")
    .filter((line) => CLAIM.test(line) && !CAVEAT.test(line))
    .map((line) => line.trim());
}

describe("replay-recovery premise guard (#721 / ADR-046)", () => {
  describe("given the queue module source as shipped", () => {
    /** @scenario the replay-premise guard passes on the corrected tree */
    it("contains no un-caveated replay-recovery claim", () => {
      // Scan .md too: groupQueue/ARCHITECTURE.md is one of ADR-046's corrected
      // sites and lives in this exact directory — the guard must protect it.
      const files = readdirSync(MODULE_DIR).filter(
        (f) =>
          (f.endsWith(".ts") || f.endsWith(".md")) && !f.includes(".test."),
      );
      const violations = files.flatMap((f) =>
        replayClaimViolations(readFileSync(path.join(MODULE_DIR, f), "utf8")).map(
          (line) => `${f}: ${line}`,
        ),
      );
      expect(violations).toEqual([]);
    });
  });

  describe("given a planted violation", () => {
    /** @scenario the replay-premise guard fails on a discarding branch that claims replay recovery */
    it("fires on an un-caveated claim and stays silent on a caveated one", () => {
      // MUST catch — including the cases a naive caveat list silences: an
      // affirmative claim ABOUT a reactor, and an unrelated "only" on the line
      // (both verified false-negatives in the hygiene review, PR #5853).
      for (const planted of [
        "// the work recovers via event replay, so the drop is safe",
        "// A reactor job recovers via event replay like everything else.",
        "// handles only high-priority jobs and recovers via event replay",
      ]) {
        expect(replayClaimViolations(planted)).toHaveLength(1);
      }

      // An unrelated denial on the ADJACENT line must NOT silence the claim line
      // (the ±1 window that used to do so is gone).
      expect(
        replayClaimViolations(
          "// this path does not park\n// the work recovers via event replay",
        ),
      ).toHaveLength(1);

      // MUST stay silent — genuinely scoped or denied on the same line.
      for (const caveated of [
        "// NOT recoverable via replay for a reactor job (see ADR-046)",
        "// recover via replay for fold/map only",
        "// This used to say 'recoverable via event replay'. It is not.",
      ]) {
        expect(replayClaimViolations(caveated)).toHaveLength(0);
      }
    });
  });
});
