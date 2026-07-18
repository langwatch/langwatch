/**
 * @vitest-environment node
 *
 * Source-level guard for valid compact-mode section markup. MainMenu must not
 * place block elements or placeholder nodes inside text elements.
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe("MainMenu compact section markup", () => {
  it("does not render <div>&nbsp;</div> inside <Text> (would hydration-warn)", () => {
    const file = readFileSync(
      path.join(__dirname, "..", "MainMenu.tsx"),
      "utf8",
    );
    expect(file).not.toMatch(/<div>&nbsp;<\/div>/);
  });

  /** @scenario MainMenu compact mode omits placeholder content */
  it("does not emit non-breaking placeholder content", () => {
    const file = readFileSync(
      path.join(__dirname, "..", "MainMenu.tsx"),
      "utf8",
    );
    expect(file).not.toMatch(/&nbsp;/);
  });
});
