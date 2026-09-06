/**
 * @vitest-environment node
 *
 * Every action the page can be asked to carry out has words for the reader.
 *
 * The status line falls back to a verb that claims nothing when it has no
 * specific truth to tell, so an action with no narration is not a broken
 * screen: it is a silent one, which is exactly the state that made a busy
 * page read as a stalled one for minutes at a time. A new action kind must
 * therefore fail here rather than quietly narrate nothing.
 */
import { describe, expect, it } from "vitest";
import { WORKBENCH_ACTION_KINDS } from "../manifest";
import {
  narrateWorkbenchAction,
  narrateWorkbenchRun,
  WORKBENCH_ACTION_NARRATION,
} from "../narration";

describe("workbench action narration", () => {
  describe("given the manifest of actions the page accepts", () => {
    /** @scenario "An action being applied says which one" */
    it("has words for every one of them", () => {
      for (const kind of WORKBENCH_ACTION_KINDS) {
        expect(narrateWorkbenchAction(kind), kind).toBeTruthy();
      }
    });

    it("names no action the manifest does not have", () => {
      const kinds = new Set<string>(WORKBENCH_ACTION_KINDS);
      for (const kind of Object.keys(WORKBENCH_ACTION_NARRATION)) {
        expect(kinds.has(kind), kind).toBe(true);
      }
    });

    /**
     * The line appends its own ellipsis, and the words are for a reader who
     * has never heard of a "target".
     */
    it("writes them as plain present-tense work", () => {
      for (const [kind, text] of Object.entries(WORKBENCH_ACTION_NARRATION)) {
        expect(text, kind).not.toMatch(/…|\.\.\.$/);
        expect(text, kind).not.toMatch(/target|workbench\./i);
        expect(text[0], kind).toBe(text[0]?.toUpperCase());
      }
    });
  });

  describe("given an unknown kind", () => {
    it("says nothing rather than guessing", () => {
      expect(narrateWorkbenchAction("workbench.notAThing")).toBeNull();
    });
  });

  describe("given a run in flight", () => {
    /** @scenario "A run streaming into the page names the column and the progress" */
    it("names the column and counts the cells", () => {
      expect(
        narrateWorkbenchRun({
          targetName: "Version A",
          completed: 12,
          total: 20,
        }),
      ).toBe("Running Version A — 12 of 20 cells");
    });

    it("drops the count before the total is known", () => {
      expect(
        narrateWorkbenchRun({
          targetName: "Version A",
          completed: 0,
          total: 0,
        }),
      ).toBe("Running Version A");
    });

    it("falls back to the plain word when the column has no name", () => {
      expect(narrateWorkbenchRun({ completed: 3, total: 9 })).toBe(
        "Running the evaluation — 3 of 9 cells",
      );
    });
  });
});
