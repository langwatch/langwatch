import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

// #721 / ADR-081: "recover via event replay" is FALSE for reactors, and that
// premise re-justified this module's silent drop from six places before it was
// caught. This guard fails if the claim reappears in the queue module WITHOUT a
// caveat scoping it to fold/map (or denying it for reactors). A guard that cannot
// disagree with its target is worthless, so the second test plants a violation and
// requires the guard to catch it — and requires a correctly-caveated line to pass.

const MODULE_DIR = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
/** Repo root: `__tests__` → groupQueue → queues → event-sourcing → server → src → app → platform. */
const REPO_ROOT = path.join(
  MODULE_DIR,
  "..",
  "..",
  "..",
  "..",
  "..",
  "..",
  "..",
);

/**
 * The corrected sites that live OUTSIDE this module, named one by one.
 *
 * ADR-081 says the false premise was asserted in six places; scanning only
 * `groupQueue/` protected the two that happen to sit there and left the rest
 * un-guarded, so a future edit stripping the caveat from the OCSF repository or
 * either ADR shipped green (review #5853 — found independently by three
 * reviewers, which is what made the gap worth closing rather than documenting).
 *
 * Explicit paths, not a recursive walk: the walk would also sweep in ADR-081
 * itself and migration `00026`, both of which quote the false claim in order to
 * refute or supersede it, and a guard that has to special-case its own evidence
 * is one bad regex away from silencing a real violation. A missing file fails
 * loudly below rather than silently shrinking the guard.
 */
const GUARDED_SITES_OUTSIDE_MODULE = [
  "platform/app/src/server/event-sourcing/ARCHITECTURE.md",
  "platform/app/ee/governance/services/governanceOcsfEvents.clickhouse.repository.ts",
  "dev/docs/adr/029-groupqueue-content-addressed-payload-store.md",
  "dev/docs/adr/030-groupqueue-blob-handling-hardening.md",
];

/** The false premise, in any of its phrasings. */
const CLAIM =
  /recover(s|able|ed)?\b[^\n]{0,24}\bvia\b[^\n]{0,24}(event\s+)?replay/i;
/**
 * Tokens that genuinely SCOPE or DENY the claim on the SAME line. Deliberately
 * NOT `reactor` (a claim stated affirmatively *about* a reactor is the single most
 * dangerous case — ADR-081) and NOT a bare `only` (an unrelated "only high-priority
 * jobs" must not silence it). Every real correction site in this module carries one
 * of these on the same line as the claim, so a same-line check needs no ±1 window —
 * which is what let an unrelated `not`/`only` on an adjacent line create a
 * false-negative (hygiene review, PR #5853).
 */
const CAVEAT_STRONG =
  /used to|adr-081|permanent loss|fold\/map|justified|once claimed/i;
/**
 * Negations that are only meaningful ADJACENT to the claim. A bare `not`/`never`
 * anywhere on the line is not evidence of a caveat — it is the same
 * unrelated-token false-negative the ±1 line window used to have, moved onto one
 * line. Review of PR #5853 showed 4 of 5 realistic phrasings slipping past a
 * whole-line test, e.g. `// This never blocks the group, and the job recovers via
 * event replay.` So these count only inside {@link CAVEAT_WINDOW} of the match.
 */
const CAVEAT_WEAK = /\bnot\b|\bnever\b|n['’]t/i;
/** Chars either side of the claim in which a weak negation still scopes it. */
const CAVEAT_WINDOW = 24;

/**
 * Lines that ASSERT replay recovers a drop, with no scoping/denying caveat on the
 * same line. Deliberately NOT exported — nothing outside this file consumes it, and
 * a test file that exports is a `noExportsInTest` violation.
 */
function replayClaimViolations(source: string): string[] {
  return source
    .split("\n")
    .filter((line) => {
      const match = CLAIM.exec(line);
      if (!match) return false;
      if (CAVEAT_STRONG.test(line)) return false;
      const from = Math.max(0, match.index - CAVEAT_WINDOW);
      const to = match.index + match[0].length + CAVEAT_WINDOW;
      return !CAVEAT_WEAK.test(line.slice(from, to));
    })
    .map((line) => line.trim());
}

describe("replay-recovery premise guard (#721 / ADR-081)", () => {
  describe("given the queue module source as shipped", () => {
    /** @scenario the replay-premise guard passes on the corrected tree */
    it("contains no un-caveated replay-recovery claim", () => {
      // Scan .md too: groupQueue/ARCHITECTURE.md is one of ADR-081's corrected
      // sites and lives in this exact directory — the guard must protect it.
      const inModule = readdirSync(MODULE_DIR)
        .filter(
          (f) =>
            (f.endsWith(".ts") || f.endsWith(".md")) && !f.includes(".test."),
        )
        .map((f) => path.join(MODULE_DIR, f));
      const outsideModule = GUARDED_SITES_OUTSIDE_MODULE.map((rel) =>
        path.join(REPO_ROOT, rel),
      );

      // A path that stops resolving must fail here, not quietly leave the guard
      // narrower than ADR-081 claims — the silent-shrink failure this list exists
      // to close in the first place.
      for (const file of outsideModule) {
        expect(existsSync(file), `guarded site missing: ${file}`).toBe(true);
      }

      const violations = [...inModule, ...outsideModule].flatMap((file) =>
        replayClaimViolations(readFileSync(file, "utf8")).map(
          (line) => `${path.relative(REPO_ROOT, file)}: ${line}`,
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
        // Same-line but UNRELATED negations — a whole-line caveat test silenced
        // all of these (test review, PR #5853).
        "// This never blocks the group, and the job recovers via event replay.",
        "// Retries do not affect this: the job recovers via event replay.",
        "// This is not a fold, and the reactor job recovers via event replay.",
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
        "// NOT recoverable via replay for a reactor job (see ADR-081)",
        "// recover via replay for fold/map only",
        "// This used to say 'recoverable via event replay'. It is not.",
      ]) {
        expect(replayClaimViolations(caveated)).toHaveLength(0);
      }
    });
  });
});
