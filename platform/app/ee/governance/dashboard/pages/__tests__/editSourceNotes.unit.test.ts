// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

/**
 * Which explanations the edit drawer owes an admin about settings its adapter
 * can no longer change.
 *
 * The marker beside the edit title shows whatever this list holds, so what the
 * list holds for a given source is the whole of the behaviour — the drawer
 * adds only a popover around it. Pinning all four combinations of pulled and
 * report here costs four function calls; pinning them through the drawer costs
 * four renders and still tests the same decision.
 *
 * The risk worth a test: the three notes must never all apply at once. A start
 * date that is fixed and a start date worth moving are the two halves of one
 * condition, and a source shown both is being told its start is frozen and
 * that moving it will restate its figures.
 */

import { describe, expect, it } from "vitest";
import { editSourceNotes } from "../inventory";

/** What each note is recognisable by, independent of its exact wording. */
const REPORT_NOTE = /the report is fixed/i;
const START_FIXED_NOTE = /the start date is fixed/i;
const RESTATE_NOTE = /restates the figures/i;

const notesFor = (hasPulled: boolean, report: string | undefined) =>
  editSourceNotes({ hasPulled, report });

describe("given the notes an edit drawer owes about locked settings", () => {
  describe("when the source has never pulled", () => {
    /** @scenario "A source that has never pulled is owed no note on either report" */
    it("owes nothing on the usage report", () => {
      // No cursor exists yet, so no setting contradicts an edit and there is
      // nothing to explain. A marker here would open onto an empty popover.
      expect(notesFor(false, "usage")).toEqual([]);
    });

    /** @scenario "A source that has never pulled is owed no note on either report" */
    it("owes nothing on the cost report", () => {
      expect(notesFor(false, "cost")).toEqual([]);
    });

    /** @scenario "A source that has never pulled is owed no note on either report" */
    it("owes nothing when the report has not been answered", () => {
      // The create form no longer allows this, but a row saved before the
      // switch existed can still reach the edit drawer without a report.
      expect(notesFor(false, undefined)).toEqual([]);
    });
  });

  describe("when the source has pulled on the usage report", () => {
    /** @scenario "A pulled usage source is owed the two notes that lock it" */
    it("owes the report note and the start-date note, in that order", () => {
      const notes = notesFor(true, "usage");

      expect(notes).toHaveLength(2);
      expect(notes[0]).toMatch(REPORT_NOTE);
      expect(notes[1]).toMatch(START_FIXED_NOTE);
    });

    /** @scenario "A pulled usage source is owed the two notes that lock it" */
    it("does not offer to restate cost history", () => {
      // A repair the usage cursor cannot perform: it never rewinds, so this
      // sentence would describe a lever that is not there.
      expect(notesFor(true, "usage").join(" ")).not.toMatch(RESTATE_NOTE);
    });
  });

  describe("when the source has pulled on the cost report", () => {
    /** @scenario "A pulled cost source is owed the report note and the restate note" */
    it("owes the report note and the restate note, in that order", () => {
      const notes = notesFor(true, "cost");

      expect(notes).toHaveLength(2);
      expect(notes[0]).toMatch(REPORT_NOTE);
      expect(notes[1]).toMatch(RESTATE_NOTE);
    });

    /** @scenario "A pulled cost source is owed the report note and the restate note" */
    it("does not say the start date is fixed, because on cost it is not", () => {
      // The cost cursor binds `startingAt` into its identity, so moving the
      // start is the deliberate repair lever rather than a setting to lock.
      expect(notesFor(true, "cost").join(" ")).not.toMatch(START_FIXED_NOTE);
    });
  });

  describe("when every combination is taken together", () => {
    /** @scenario "No source is ever owed all three notes" */
    it("never owes more than two notes", () => {
      const everyCombination = [true, false].flatMap((hasPulled) =>
        ["usage", "cost", undefined].map((report) => ({
          hasPulled,
          report,
          notes: notesFor(hasPulled, report),
        })),
      );

      for (const { hasPulled, report, notes } of everyCombination) {
        expect(
          notes.length,
          `hasPulled=${hasPulled} report=${report}`,
        ).toBeLessThanOrEqual(2);
      }
    });

    /** @scenario "No source is ever owed all three notes" */
    it("never pairs a fixed start with an invitation to move it", () => {
      for (const hasPulled of [true, false]) {
        for (const report of ["usage", "cost", undefined]) {
          const joined = notesFor(hasPulled, report).join(" ");
          const saysFixed = START_FIXED_NOTE.test(joined);
          const saysMovable = RESTATE_NOTE.test(joined);

          expect(
            saysFixed && saysMovable,
            `hasPulled=${hasPulled} report=${report}`,
          ).toBe(false);
        }
      }
    });
  });
});
