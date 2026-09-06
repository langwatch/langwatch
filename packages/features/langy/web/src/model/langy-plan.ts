/**
 * The plan a turn is following, folded from the agent's `todowrite` tool parts.
 */

import { z } from "zod";

/** A plan item's lifecycle, mirroring opencode's todo statuses. */
export type LangyPlanItemStatus = "pending" | "in_progress" | "completed" | "cancelled";

export interface LangyPlanItem {
  content: string;
  status: LangyPlanItemStatus;
}

export interface LangyPlan {
  /** The steps, in order, from the latest full todo list. */
  items: LangyPlanItem[];
  /** Index of the single in-progress item in `items`, or -1 when none is. */
  currentIndex: number;
  /** Steps that reached `completed`. */
  completedCount: number;
  /** Steps that count toward the total — everything except cancelled. */
  totalCount: number;
  /** Tool calls made before any plan item became active. */
  preamble: unknown[];
  /** Tool calls attributed to each plan item by its active snapshot. */
  itemParts: unknown[][];
}

const toolPartSchema = z
  .object({
    type: z.string(),
    toolName: z.string().optional(),
    input: z.unknown().optional(),
  })
  .loose();
const inputPartSchema = z.object({ input: z.unknown().optional() }).loose();
const todoContainerSchema = z.union([
  z.array(z.unknown()),
  z
    .object({ todos: z.array(z.unknown()) })
    .loose()
    .transform(({ todos }) => todos),
]);
const todoItemSchema = z
  .object({
    content: z.string(),
    status: z.unknown().optional(),
  })
  .loose();

/** The tool names that ARE the plan channel — never rendered as activity. */
const PLAN_TOOL_NAMES = new Set(["todowrite", "todoread"]);

/**
 * Models occasionally repeat the machine status in the customer-facing step
 * text (`Do the thing (in_progress)`). The status already has its own typed
 * field, so showing that suffix is both redundant and visually noisy.
 */
export function cleanPlanContent(content: string): string {
  return content
    .trim()
    .replace(/\s*\((?:pending|in[_ -]?progress|completed|cancelled)(?::[^)]*)?\)\s*$/i, "")
    .trim();
}

/** The raw tool name a part carries, or undefined for a non-tool part. */
function tryReadToolName(part: unknown): string | undefined {
  const parsed = toolPartSchema.safeParse(part);
  if (!parsed.success) return void 0;

  const { type, toolName } = parsed.data;
  if (type === "dynamic-tool") {
    return toolName;
  }
  if (type.startsWith("tool-")) return type.slice("tool-".length);
  return void 0;
}

/** True when a part is the plan tool (`todowrite`/`todoread`). */
export function isPlanToolPart(part: unknown): boolean {
  const name = tryReadToolName(part);
  return name !== void 0 && PLAN_TOOL_NAMES.has(name.toLowerCase());
}

/** A part's `input`, JSON-decoded when it arrived as a string. */
function tryReadPartInput(part: unknown): unknown {
  const parsed = inputPartSchema.safeParse(part);
  if (!parsed.success) return void 0;

  const raw = parsed.data.input;
  if (typeof raw !== "string") return raw;
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

/**
 * Parse a `todowrite` input into a normalised item list, shape-tolerant of the two ways
 * the todos can arrive (`{ todos: [...] }` or a bare array) and of a status the tool
 * never promised.
 */
/**
 * Every status word that means one of the four the tool promised. `todowrite` documents
 * `pending | in_progress | completed | cancelled` and the status crosses the wire as a free
 * string, so a model that writes "done" or "in-progress" used to land every step on `pending`.
 * Kept identical to `normalizeTodoStatus` in the worker's own `todowrite` tool.
 */
const PLAN_STATUS_BY_WORD: Record<string, LangyPlanItemStatus> = {
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
 * The plan status a wire value means. An unknown word stays `pending`: a step is only ever
 * ticked from a status the agent actually wrote.
 */
export function normalisePlanStatus(status: unknown): LangyPlanItemStatus {
  if (typeof status !== "string") return "pending";
  const word = status
    .trim()
    .toLowerCase()
    .replace(/[-\s]+/g, "_");
  return PLAN_STATUS_BY_WORD[word] ?? "pending";
}

/**
 * The fresher of the two snapshots.
 *
 * The override is the live store's copy of the plan, and it is not always the
 * newer one: if the stream dropped, or this tab adopted the turn late, it can
 * still hold the all-pending list from the first `todowrite` call while the
 * message's own parts already carry the finished steps. `todowrite` rewrites
 * the whole list every call and a step never un-finishes, so more completed
 * steps can only come from a later snapshot, which makes the completed count
 * the one comparison that cannot invent progress.
 */
function fresherSnapshot({
  override,
  derived,
}: {
  override: LangyPlanItem[] | null;
  derived: LangyPlanItem[] | null;
}): LangyPlanItem[] | null {
  if (!override || override.length === 0) return derived;
  if (!derived || derived.length === 0) return override;
  return completedCountOf(derived) > completedCountOf(override) ? derived : override;
}

/** How many steps of one snapshot are finished. */
function completedCountOf(items: LangyPlanItem[]): number {
  return items.filter((item) => item.status === "completed").length;
}

export function parseTodoList(input: unknown): LangyPlanItem[] | null {
  const parsedContainer = todoContainerSchema.safeParse(input);
  if (!parsedContainer.success) return null;

  const items: LangyPlanItem[] = [];
  for (const entry of parsedContainer.data) {
    const parsedItem = todoItemSchema.safeParse(entry);
    if (!parsedItem.success) continue;

    const content = cleanPlanContent(parsedItem.data.content);
    if (!content) continue;
    items.push({ content, status: normalisePlanStatus(parsedItem.data.status) });
  }
  return items;
}

/** Index of the single in-progress item, or -1 (first wins if the model erred). */
function inProgressIndex(items: LangyPlanItem[]): number {
  return items.findIndex((it) => it.status === "in_progress");
}

/** Normalise a wire item (permissive `status` string) into a plan item. */
function normaliseItem(item: { content: string; status: string }): LangyPlanItem {
  return { content: cleanPlanContent(item.content), status: normalisePlanStatus(item.status) };
}

/**
 * Fold a message's tool parts into the plan it was following, or null when the agent
 * never maintained a todo list (⇒ no checklist, today's rendering).
 */
export function langyPlan(
  message: { parts: readonly unknown[] },
  opts?: {
    /**
     * The manager's typed plan snapshot for the LIVE turn (capped + truncated). When
     * present it is PREFERRED over parsing the raw todowrite parts — the client then
     * enforces the same caps the manager did.
     */
    overrideItems?: Array<{ content: string; status: string }> | null;
  },
): LangyPlan | null {
  const parts = message.parts ?? [];

  // The latest valid snapshot from the tool parts (used for attribution, and as
  // the plan itself when there is no typed override).
  let derived: LangyPlanItem[] | null = null;
  for (const part of parts) {
    if (!isPlanToolPart(part)) continue;
    const parsed = parseTodoList(tryReadPartInput(part));
    if (parsed && parsed.length > 0) derived = parsed;
  }

  const override =
    opts?.overrideItems && opts.overrideItems.length > 0
      ? opts.overrideItems.map(normaliseItem).filter((it) => it.content)
      : null;

  const items = fresherSnapshot({ override, derived });
  if (!items || items.length === 0) return null;

  const itemParts: unknown[][] = items.map(() => []);
  const preamble: unknown[] = [];

  // Walk the stream, tracking which LATEST-list item is currently in-progress.
  let currentItemIndex = -1;
  for (const part of parts) {
    if (isPlanToolPart(part)) {
      const snapshot = parseTodoList(tryReadPartInput(part));
      if (!snapshot) continue;
      const ip = inProgressIndex(snapshot);
      if (ip !== -1) {
        // Map the snapshot's in-progress item onto the latest list by content:
        // a call made while step 2 ran belongs to step 2 even now that it reads
        // "completed". An item whose text has since changed falls to preamble.
        const currentItem = snapshot[ip];
        if (currentItem) {
          currentItemIndex = items.findIndex((item) => item.content === currentItem.content);
        }
      }
      continue;
    }
    if (tryReadToolName(part) === void 0) continue; // not a tool call

    const item = itemParts[currentItemIndex];
    if (currentItemIndex >= 0 && item) {
      item.push(part);
    } else {
      preamble.push(part);
    }
  }

  const completedCount = items.filter((it) => it.status === "completed").length;
  const totalCount = items.filter((it) => it.status !== "cancelled").length;

  return {
    items,
    currentIndex: inProgressIndex(items),
    completedCount,
    totalCount,
    preamble,
    itemParts,
  };
}
