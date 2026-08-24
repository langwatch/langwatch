import { describe, expect, it } from "vitest";
import { normalizeTodos, renderTodoList } from "./todowrite.js";

describe("normalizeTodos", () => {
  describe("when the opencode wrapper shape", () => {
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
