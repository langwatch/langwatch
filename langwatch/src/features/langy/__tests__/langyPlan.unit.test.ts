/**
 * @vitest-environment node
 *
 * The plan fold — a message's `todowrite` tool parts → the checklist the panel
 * renders, plus the other tool calls attributed to the step that was running
 * when each one appeared. Pure; no rendering here (see LangyPlanCard tests).
 */
import { describe, expect, it } from "vitest";
import { cleanPlanContent, langyPlan, parseTodoList } from "../logic/langyPlan";

/** A `todowrite` snapshot part carrying a whole-list rewrite. */
function todo(todos: Array<{ content: string; status: string }>): {
  type: string;
  input: unknown;
} {
  return { type: "tool-todowrite", input: { todos } };
}

/** A non-plan tool call part. */
function tool(
  name: string,
  id: string,
  input: unknown = {},
): { type: string; toolCallId: string; input: unknown } {
  return { type: `tool-${name}`, toolCallId: id, input };
}

describe("langyPlan", () => {
  describe("given a message with no todo list", () => {
    it("returns null so the message renders as it does today", () => {
      const message = {
        parts: [tool("bash", "c1"), { type: "text", text: "hi" }],
      };
      expect(langyPlan(message)).toBeNull();
    });
  });

  describe("given several full-list rewrites in one turn", () => {
    it("reflects the most recent full list, not an earlier one", () => {
      const message = {
        parts: [
          todo([
            { content: "Find slow traces", status: "in_progress" },
            { content: "Summarise them", status: "pending" },
          ]),
          todo([
            { content: "Find slow traces", status: "completed" },
            { content: "Summarise them", status: "in_progress" },
            { content: "Open a fix", status: "pending" },
          ]),
        ],
      };

      const plan = langyPlan(message)!;
      expect(plan.items.map((i) => i.content)).toEqual([
        "Find slow traces",
        "Summarise them",
        "Open a fix",
      ]);
      expect(plan.currentIndex).toBe(1);
      expect(plan.completedCount).toBe(1);
      expect(plan.totalCount).toBe(3);
    });
  });

  describe("given tool calls interleaved with plan updates", () => {
    it("attributes each call to the step that was current when it started", () => {
      const message = {
        parts: [
          tool("bash", "warmup"), // before any plan → preamble
          todo([
            { content: "Find slow traces", status: "in_progress" },
            { content: "Summarise them", status: "pending" },
          ]),
          tool("bash", "search"), // step 1 running
          todo([
            { content: "Find slow traces", status: "completed" },
            { content: "Summarise them", status: "in_progress" },
          ]),
          tool("bash", "read"), // step 2 running
        ],
      };

      const plan = langyPlan(message)!;
      expect(plan.preamble).toHaveLength(1);
      expect((plan.preamble[0] as { toolCallId: string }).toolCallId).toBe(
        "warmup",
      );
      expect(
        plan.itemParts[0]!.map((p) => (p as { toolCallId: string }).toolCallId),
      ).toEqual(["search"]);
      expect(
        plan.itemParts[1]!.map((p) => (p as { toolCallId: string }).toolCallId),
      ).toEqual(["read"]);
    });

    it("does not attribute a preamble call to a later step", () => {
      const message = {
        parts: [
          tool("bash", "early"),
          todo([{ content: "Do the thing", status: "in_progress" }]),
        ],
      };
      const plan = langyPlan(message)!;
      expect(plan.itemParts[0]).toEqual([]);
      expect(plan.preamble).toHaveLength(1);
    });
  });

  describe("given malformed or partial todo input", () => {
    it("removes redundant machine statuses from customer-facing step text", () => {
      expect(cleanPlanContent("Create the dataset (in_progress)")).toBe(
        "Create the dataset",
      );
      expect(
        cleanPlanContent(
          "Create an evaluator (in_progress: blocked by insufficient permissions)",
        ),
      ).toBe("Create an evaluator");
      expect(cleanPlanContent("Finish the report (completed)")).toBe(
        "Finish the report",
      );
    });

    it("ignores rows without content and tolerates an unknown status", () => {
      const items = parseTodoList({
        todos: [
          { content: "Real step", status: "banana" },
          { content: "", status: "pending" },
          { status: "in_progress" },
          { content: "  Trimmed  ", status: "completed" },
        ],
      });
      expect(items).toEqual([
        { content: "Real step", status: "pending" },
        { content: "Trimmed", status: "completed" },
      ]);
    });

    it("returns null for input that is not list-shaped", () => {
      expect(parseTodoList("not json")).toBeNull();
      expect(parseTodoList({ nope: true })).toBeNull();
      expect(parseTodoList(null)).toBeNull();
    });

    it("skips a malformed snapshot but keeps a valid later one", () => {
      const message = {
        parts: [
          { type: "tool-todowrite", input: "garbage" },
          todo([{ content: "Only real step", status: "in_progress" }]),
        ],
      };
      const plan = langyPlan(message)!;
      expect(plan.items).toEqual([
        { content: "Only real step", status: "in_progress" },
      ]);
    });

    it("accepts a bare array of todos, not only { todos: [...] }", () => {
      const items = parseTodoList([
        { content: "Step one", status: "completed" },
      ]);
      expect(items).toEqual([{ content: "Step one", status: "completed" }]);
    });
  });

  describe("given a cancelled step", () => {
    it("keeps it in order but excludes it from the total", () => {
      const message = {
        parts: [
          todo([
            { content: "Kept", status: "completed" },
            { content: "Abandoned", status: "cancelled" },
            { content: "Doing now", status: "in_progress" },
          ]),
        ],
      };
      const plan = langyPlan(message)!;
      expect(plan.items.map((i) => i.status)).toEqual([
        "completed",
        "cancelled",
        "in_progress",
      ]);
      expect(plan.completedCount).toBe(1);
      // Three rows, one cancelled ⇒ counts toward neither done nor total.
      expect(plan.totalCount).toBe(2);
    });
  });

  describe("given the manager's typed plan override (the live turn)", () => {
    it("prefers the override items over parsing the todowrite part", () => {
      const message = {
        parts: [
          // The raw part carries an over-long, unbounded list…
          todo([
            { content: "Raw uncapped step", status: "in_progress" },
            { content: "Second raw step", status: "pending" },
          ]),
        ],
      };
      const plan = langyPlan(message, {
        // …but the manager's typed snapshot (capped/truncated) wins.
        overrideItems: [{ content: "Capped step", status: "in_progress" }],
      })!;
      expect(plan.items).toEqual([
        { content: "Capped step", status: "in_progress" },
      ]);
    });

    it("still attributes tool calls from the message's snapshot history", () => {
      const message = {
        parts: [
          todo([{ content: "Do the thing", status: "in_progress" }]),
          tool("bash", "c1"),
        ],
      };
      const plan = langyPlan(message, {
        overrideItems: [{ content: "Do the thing", status: "in_progress" }],
      })!;
      // The override supplies the items; attribution still comes from the parts.
      expect(
        plan.itemParts[0]!.map((p) => (p as { toolCallId: string }).toolCallId),
      ).toEqual(["c1"]);
    });

    it("normalises an unknown override status to pending", () => {
      const plan = langyPlan(
        { parts: [] },
        { overrideItems: [{ content: "Step", status: "weird" }] },
      )!;
      expect(plan.items).toEqual([{ content: "Step", status: "pending" }]);
    });

    it("ignores an empty override and falls back to the parts", () => {
      const message = {
        parts: [todo([{ content: "From parts", status: "in_progress" }])],
      };
      const plan = langyPlan(message, { overrideItems: [] })!;
      expect(plan.items).toEqual([
        { content: "From parts", status: "in_progress" },
      ]);
    });
  });

  describe("given a turn with no in-progress step", () => {
    it("reports currentIndex -1", () => {
      const message = {
        parts: [
          todo([
            { content: "One", status: "completed" },
            { content: "Two", status: "completed" },
          ]),
        ],
      };
      expect(langyPlan(message)!.currentIndex).toBe(-1);
    });
  });
});
