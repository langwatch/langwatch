/**
 * The `todowrite` tool: the plan channel. It takes the wrapper shape
 * ({ todos: [{content, status}] }; a bare array is tolerated)
 * because the panel checklist and the X/Y progress protocol depend
 * on that shape, but built on pi's official extension pattern
 * (pi.registerTool + session-entry state reconstruction, adapted from
 * examples/extensions/todo.ts).
 */

import { Type } from "typebox";
import type { ExtensionAPI, ExtensionContext, InlineExtension } from "@earendil-works/pi-coding-agent";

export const TODOWRITE_TOOL_NAME = "todowrite";

export const TODO_STATUSES = ["pending", "in_progress", "completed", "cancelled"] as const;
export type TodoStatus = (typeof TODO_STATUSES)[number];

export type TodoItem = { content: string; status: TodoStatus };

const todowriteParams = Type.Object({
  todos: Type.Array(
    Type.Object({
      content: Type.String({ description: "The task, worded as an outcome" }),
      status: Type.String({
        description: "One of: pending, in_progress, completed, cancelled",
      }),
    }),
    { description: "The full todo list. Every call replaces the whole list." },
  ),
});

/**
 * Every status word that means one of the four this tool promised.
 *
 * The status is a free string, so a model that writes "done", "Completed" or
 * "in-progress" instead used to have every one of its steps recorded as
 * `pending`, and the panel's checklist then read "0 of 5 done" for a turn in
 * which all five steps had finished. The word is lower-cased, and spaces and
 * dashes fold to `_`, before the lookup.
 *
 * Kept identical to `normalisePlanStatus` in the panel
 * (platform/app/src/features/langy/logic/langyPlan.ts). This package compiles
 * to its own binary and does not depend on the app's workspace packages, so
 * the two copies are pinned by tests on both sides rather than shared.
 */
const TODO_STATUS_BY_WORD: Record<string, TodoStatus> = {
  pending: "pending",
  todo: "pending",
  not_started: "pending",
  in_progress: "in_progress",
  active: "in_progress",
  doing: "in_progress",
  completed: "completed",
  complete: "completed",
  done: "completed",
  finished: "completed",
  cancelled: "cancelled",
  canceled: "cancelled",
  skipped: "cancelled",
  wont_do: "cancelled",
};

/**
 * The status a wire value means. An unknown word stays `pending`: a step is
 * only ever ticked from a status the model actually wrote.
 */
export function normalizeTodoStatus(status: unknown): TodoStatus {
  if (typeof status !== "string") return "pending";
  const word = status.trim().toLowerCase().replace(/[-\s]+/g, "_");
  return TODO_STATUS_BY_WORD[word] ?? "pending";
}

/**
 * Normalize whatever the model sent into the canonical list. Tolerates the
 * `{ todos: [...] }` wrapper AND a bare array, the status synonyms above, and
 * drops empty-content rows.
 */
export function normalizeTodos(params: unknown): TodoItem[] {
  const rows: unknown[] = Array.isArray(params)
    ? params
    : typeof params === "object" && params !== null && Array.isArray((params as { todos?: unknown }).todos)
      ? ((params as { todos: unknown[] }).todos)
      : [];
  const items: TodoItem[] = [];
  for (const row of rows) {
    if (typeof row !== "object" || row === null) continue;
    const { content, status } = row as { content?: unknown; status?: unknown };
    if (typeof content !== "string" || content.trim().length === 0) continue;
    items.push({ content: content.trim(), status: normalizeTodoStatus(status) });
  }
  return items;
}

export function renderTodoList(todos: TodoItem[]): string {
  if (todos.length === 0) return "Todo list cleared.";
  const marks: Record<TodoStatus, string> = {
    pending: "[ ]",
    in_progress: "[~]",
    completed: "[x]",
    cancelled: "[-]",
  };
  return todos.map((t) => `${marks[t.status]} ${t.content}`).join("\n");
}

export function createTodowriteExtension(): InlineExtension {
  return {
    name: "langy-todowrite",
    factory: (pi: ExtensionAPI) => {
      let todos: TodoItem[] = [];

      // Reconstruct the list from session entries so a resumed session keeps
      // its plan (same pattern as pi's official todo example: state lives in
      // tool result details, which follows branching correctly).
      const reconstructState = (ctx: ExtensionContext) => {
        todos = [];
        for (const entry of ctx.sessionManager.getBranch()) {
          if (entry.type !== "message") continue;
          const message = entry.message as {
            role?: string;
            toolName?: string;
            details?: { todos?: TodoItem[] };
          };
          if (message.role !== "toolResult" || message.toolName !== TODOWRITE_TOOL_NAME) continue;
          // A session file written by another worker version can carry statuses
          // this build does not know, so it is validated and copied, not adopted.
          if (Array.isArray(message.details?.todos)) {
            todos = normalizeTodos(message.details.todos);
          }
        }
      };

      pi.on("session_start", async (_event, ctx) => reconstructState(ctx));
      pi.on("session_tree", async (_event, ctx) => reconstructState(ctx));

      pi.registerTool({
        name: TODOWRITE_TOOL_NAME,
        label: "Todo",
        description:
          "Maintain the live todo list the user sees. Pass the FULL list on every call ({\"todos\": [{\"content\", \"status\"}]}); each call replaces the previous list. Statuses: pending, in_progress, completed, cancelled. Keep exactly one item in_progress at a time.",
        parameters: todowriteParams,
        async execute(_toolCallId, params) {
          todos = normalizeTodos(params);
          return {
            content: [{ type: "text", text: renderTodoList(todos) }],
            details: { todos: [...todos] },
          };
        },
      });
    },
  };
}
