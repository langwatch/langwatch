/**
 * @vitest-environment node
 *
 * Source-level guard for lw#3586 F12: MainMenu's compact-mode placeholders
 * MUST NOT render `<div>&nbsp;</div>` inside Chakra `<Text>` (which renders
 * a `<p>`), because `<div>` cannot be a descendant of `<p>` and React flags
 * it as a hydration error in dev. The fix uses Fragments instead.
 *
 * A source-text check is enough here because the offending pattern is
 * unambiguous and the fix is a 4-character substitution; a render test
 * would require the full nav store / chakra wiring for marginal extra
 * confidence.
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe("MainMenu placeholders (lw#3586 F12)", () => {
  /** @scenario MainMenu compact-mode placeholders use Fragments not divs to avoid hydration warnings */
  it("does not render <div>&nbsp;</div> inside <Text> (would hydration-warn)", () => {
    const file = readFileSync(
      path.join(__dirname, "..", "MainMenu.tsx"),
      "utf8",
    );
    expect(file).not.toMatch(/<div>&nbsp;<\/div>/);
  });

  it("uses Fragment <>&nbsp;</> for compact placeholders", () => {
    const file = readFileSync(
      path.join(__dirname, "..", "MainMenu.tsx"),
      "utf8",
    );
    expect(file).toMatch(/<>&nbsp;<\/>/);
  });
});
