/**
 * The icons the two menus of the Scenarios tab read.
 *
 * @see specs/features/agent-testing/suites-rail.feature
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { MENU_ACTION_ICONS } from "../../../../sections/agent-testing/cases/menu-action-label";

/** The row menus are elements; the button above the table is a section. */
const ELEMENT_CASES_DIR = join(__dirname, "..", "..", "cases");
const SECTION_CASES_DIR = join(
  __dirname,
  "..",
  "..",
  "..",
  "..",
  "sections",
  "agent-testing",
  "cases",
);

function sourceOf(dir: string, file: string): string {
  return readFileSync(join(dir, file), "utf8");
}

describe("given the actions the suites rail and the scenario rows share", () => {
  /** @scenario "The rail menu and the scenario row menu read one list of icons" */
  it("reads every icon from the one list, with one pencil for both name edits", () => {
    for (const icon of Object.values(MENU_ACTION_ICONS)) {
      expect(icon).toBeTruthy();
    }
    expect(MENU_ACTION_ICONS.rename).toBe(MENU_ACTION_ICONS.edit);

    for (const file of ["suite-rail-menu.tsx", "cases-table.tsx"]) {
      expect(sourceOf(ELEMENT_CASES_DIR, file)).toContain("MenuActionLabel");
    }
  });

  /** @scenario "Every way into a recent run carries the same list icon" */
  it("gives the button above the table the same list icon, and leaves history to the versions", () => {
    const button = sourceOf(SECTION_CASES_DIR, "recent-runs-menu.tsx");

    // The button reads the icon from the shared list rather than naming one of
    // its own, so a way into a run cannot drift from the row menus.
    expect(button).toContain("MENU_ACTION_ICONS.openRecentRuns");
    // The history icon means the version history of a scenario. A way into a
    // run that carried it read as a way into the versions.
    expect(button).not.toContain("History");
  });
});
