import { describe, expect, it } from "vitest";
import { normalizeTodos, normalizeTodoStatus, renderTodoList } from "./todowrite.js";

describe("normalizeTodos", () => {
  describe("when the wrapper shape", () => {
    it("returns the items", () => {
      expect(
        normalizeTodos({
          todos: [
            { content: "Find the slowest traces", status: "in_progress" },
            { content: "Report", status: "pending" },
          ],
        }),
      ).toEqual([
        { content: "Find the slowest traces", status: "in_progress" },
        { content: "Report", status: "pending" },
      ]);
    });
  });

  describe("when a bare array", () => {
    it("tolerates it", () => {
      expect(normalizeTodos([{ content: "A", status: "completed" }])).toEqual([
        { content: "A", status: "completed" },
      ]);
    });
  });

  describe("when unknown statuses and junk rows", () => {
    it("maps unknown statuses to pending and drops empty rows", () => {
      expect(
        normalizeTodos({
          todos: [
            { content: "A", status: "doing-it" },
            { content: "  ", status: "pending" },
            { content: "B" },
            "not an object",
            null,
          ],
        }),
      ).toEqual([
        { content: "A", status: "pending" },
        { content: "B", status: "pending" },
      ]);
    });
  });

  describe("when a status is another word for one of the four", () => {
    /**
     * The panel's checklist mirrors what this records, so a model writing
     * "done" instead of "completed" used to produce "0 of 5 done" for a turn
     * in which every step had finished.
     *
     * @scenario "The agent's own todo tool reads those words the same way" */
    it("records the step under the status that word means", () => {
      expect(
        normalizeTodos({
          todos: [
            { content: "A", status: "done" },
            { content: "B", status: "Completed" },
            { content: "C", status: "in-progress" },
            { content: "D", status: "TODO" },
            { content: "E", status: "skipped" },
          ],
        }),
      ).toEqual([
        { content: "A", status: "completed" },
        { content: "B", status: "completed" },
        { content: "C", status: "in_progress" },
        { content: "D", status: "pending" },
        { content: "E", status: "cancelled" },
      ]);
    });

    /**
     * Kept identical to `normalisePlanStatus` in the panel
     * (platform/app/src/features/langy/logic/langyPlan.ts). The two are pinned
     * by the same table on both sides because this package cannot import it.
     */
    it("reads every synonym the same way, whatever its case or spacing", () => {
      const cases: Array<[string, string]> = [
        ["done", "completed"],
        ["Complete", "completed"],
        ["FINISHED", "completed"],
        ["  in progress  ", "in_progress"],
        ["In-Progress", "in_progress"],
        ["active", "in_progress"],
        ["doing", "in_progress"],
        ["not started", "pending"],
        ["todo", "pending"],
        ["skipped", "cancelled"],
        ["canceled", "cancelled"],
        ["wont_do", "cancelled"],
      ];
      for (const [word, expected] of cases) {
        expect(normalizeTodoStatus(word), word).toBe(expected);
      }
    });

    it("leaves a word it does not know as pending", () => {
      expect(normalizeTodoStatus("banana")).toBe("pending");
      expect(normalizeTodoStatus("")).toBe("pending");
      expect(normalizeTodoStatus(undefined)).toBe("pending");
      expect(normalizeTodoStatus(7)).toBe("pending");
    });
  });

  describe("when nothing usable", () => {
    it("returns an empty list", () => {
      expect(normalizeTodos(undefined)).toEqual([]);
      expect(normalizeTodos({ todos: "nope" })).toEqual([]);
      expect(normalizeTodos(42)).toEqual([]);
    });
  });
});

describe("renderTodoList", () => {
  it("renders checkbox marks per status", () => {
    expect(
      renderTodoList([
        { content: "A", status: "pending" },
        { content: "B", status: "in_progress" },
        { content: "C", status: "completed" },
        { content: "D", status: "cancelled" },
      ]),
    ).toBe("[ ] A\n[~] B\n[x] C\n[-] D");
  });

  it("names the empty state", () => {
    expect(renderTodoList([])).toBe("Todo list cleared.");
  });
});
