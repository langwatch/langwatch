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
/** Tokens that scope the claim to fold/map, deny it, or quote it as a past error. */
const CAVEAT =
  /\bnot\b|\bnever\b|used to|n['’]t|reactor|adr-046|permanent loss|fold\/map|justified|once claimed|\bonly\b/i;

/**
 * Lines that ASSERT replay recovers a drop, without a caveat within ±1 line.
 * The window lets a denial or scoping qualifier sit on the neighbouring line
 * (as several of this module's corrected doc-comments do).
 */
export function replayClaimViolations(source: string): string[] {
  const lines = source.split("\n");
  const out: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (!CLAIM.test(lines[i]!)) continue;
    const window = [lines[i - 1], lines[i], lines[i + 1]]
      .filter((l): l is string => l != null)
      .join(" ");
    if (!CAVEAT.test(window)) out.push(lines[i]!.trim());
  }
  return out;
}

describe("replay-recovery premise guard (#721 / ADR-046)", () => {
  describe("given the queue module source as shipped", () => {
    it("contains no un-caveated replay-recovery claim", () => {
      const files = readdirSync(MODULE_DIR).filter(
        (f) => f.endsWith(".ts") && !f.includes(".test."),
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
    it("fires on an un-caveated claim and stays silent on a caveated one", () => {
      const planted = "// the work recovers via event replay, so the drop is safe";
      expect(replayClaimViolations(planted)).toHaveLength(1);

      const caveated =
        "// NOT recoverable via replay for a reactor job (see ADR-046)";
      expect(replayClaimViolations(caveated)).toHaveLength(0);
    });
  });
});
