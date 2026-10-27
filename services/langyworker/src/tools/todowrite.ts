/**
 * The `todowrite` tool: the plan channel. Takes the wrapper shape
 * (`{ todos: [{content, status}] }`, a bare array tolerated) - built on pi's
 * official extension pattern (examples/extensions/todo.ts).
 */

import type {
  ExtensionAPI,
  ExtensionContext,
  InlineExtension,
} from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

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
 * Every status word meaning one of the four this tool promised - free
 * strings like "Completed" used to silently record as `pending`. Kept
 * identical to `normalisePlanStatus` in the panel; pinned by tests, not shared.
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
  const word = status
    .trim()
    .toLowerCase()
    .replace(/[-\s]+/g, "_");
  return TODO_STATUS_BY_WORD[word] ?? "pending";
}

/**
 * Normalize whatever the model sent into the canonical list. Tolerates the
 * `{ todos: [...] }` wrapper AND a bare array, the status synonyms above, and
 * drops empty-content rows.
 */
function todoRowsOf(params: unknown): unknown[] {
  if (Array.isArray(params)) return params;
  if (typeof params !== "object" || params === null || !("todos" in params)) return [];
  return Array.isArray(params.todos) ? params.todos : [];
}

export function normalizeTodos(params: unknown): TodoItem[] {
  const rows = todoRowsOf(params);
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

function todosFromBranch(ctx: ExtensionContext): TodoItem[] {
  let todos: TodoItem[] = [];
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
  return todos;
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
        todos = todosFromBranch(ctx);
      };

      pi.on("session_start", async (_event, ctx) => reconstructState(ctx));
      pi.on("session_tree", async (_event, ctx) => reconstructState(ctx));

      pi.registerTool({
        name: TODOWRITE_TOOL_NAME,
        label: "Todo",
        description:
          'Maintain the live todo list the user sees. Pass the FULL list on every call ({"todos": [{"content", "status"}]}); each call replaces the previous list. Statuses: pending, in_progress, completed, cancelled. Keep exactly one item in_progress at a time.',
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
