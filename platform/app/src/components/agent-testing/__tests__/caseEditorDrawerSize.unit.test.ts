/**
 * How wide the scenario editor drawer opens, and that the width is a named step
 * of the drawer recipe rather than an override at the call site.
 *
 * @see specs/features/agent-testing/cases-table.feature
 * @see dev/docs/best_practices/drawers.md
 */

import { describe, expect, it } from "vitest";
import { drawerSlotRecipe } from "~/theme/recipes/drawer";
import { CASE_EDITOR_DRAWER_SIZE } from "../cases/drawerKeys";

/** What Chakra's own drawer recipe gives the two steps either side of ours. */
const CHAKRA_MD_REM = 32;
const CHAKRA_LG_REM = 42;

function sizeMaxWidth(size: string): string {
  const sizes = drawerSlotRecipe.variants?.size as
    | Record<string, { content?: { maxWidth?: string } }>
    | undefined;
  return sizes?.[size]?.content?.maxWidth ?? "";
}

describe("the scenario editor drawer width", () => {
  /** @scenario "The scenario editor opens wider than a standard drawer" */
  it("names a step the drawer recipe defines", () => {
    expect(sizeMaxWidth(CASE_EDITOR_DRAWER_SIZE)).not.toBe("");
  });

  describe("when the step is measured against Chakra's own steps", () => {
    const rem = Number.parseFloat(sizeMaxWidth(CASE_EDITOR_DRAWER_SIZE));

    it("is about a fifth wider than the medium drawer", () => {
      expect(rem / CHAKRA_MD_REM).toBeGreaterThan(1.15);
      expect(rem / CHAKRA_MD_REM).toBeLessThan(1.25);
    });

    it("stays narrower than the large drawer", () => {
      expect(rem).toBeLessThan(CHAKRA_LG_REM);
    });
  });
});
