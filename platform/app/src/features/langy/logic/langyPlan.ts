/**
 * The plan a turn is following, folded from the agent's `todowrite` tool parts.
 *
 * ── WHY THIS EXISTS ─────────────────────────────────────────────────────────
 * Langy's agent keeps a todo list with the `todowrite` tool for multi-step work
 * (AGENTS.md, "How you work"). The `todowrite` tool is a WHOLE-LIST REWRITE
 * per call —
 * `{ todos: [{ content, status }] }`, status ∈ pending | in_progress | completed
 * | cancelled — so the plan already crosses the wire as ordinary tool input and
 * lands durable on the message (each call is a `tool-todowrite` part carrying its
 * input). The panel MIRRORS that list as a live checklist. Nothing is scraped
 * from prose; the tool IS the plan (see the killed `[langy:progress:*]` sentinels
 * in MessageContent.tsx for why prose protocols are not an option here).
 *
 * This module is the pure, JSX-free fold: a message's tool parts → the latest
 * plan snapshot + the OTHER tool calls attributed to the plan item that was
 * running when each one started. Same "derive from what ran, never from
 * narration" precedent as `githubProgressFromToolParts`; degrades gracefully.
 */

/** A plan item's lifecycle, mirroring the worker's todo statuses. */
export type LangyPlanItemStatus =
  | "pending"
  | "in_progress"
  | "completed"
  | "cancelled";

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
}

/**
 * Every status word that means one of the four the tool promised.
 *
 * `todowrite` documents `pending | in_progress | completed | cancelled`, and
 * the status crosses the wire as a free string. A model that writes "done",
 * "Completed" or "in-progress" instead used to land every one of its steps on
 * `pending`, so the card read "Plan · 0 of 5 done" for a turn in which all
 * five steps had finished. The word is lower-cased, and spaces and dashes fold
 * to `_`, before the lookup, so only a genuinely unknown word falls back.
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
 * The plan status a wire value means. An unknown word stays `pending`: a step
 * is only ever ticked from a status the agent actually wrote.
 *
 * Kept identical to `normalizeTodoStatus` in the worker's `todowrite` tool
 * (services/langyworker/src/tools/todowrite.ts). The worker is a standalone
 * package that compiles to its own binary and does not depend on this one, so
 * the two copies are pinned by tests on both sides rather than shared.
 */
export function normalisePlanStatus(status: unknown): LangyPlanItemStatus {
  if (typeof status !== "string") return "pending";
  const word = status
    .trim()
    .toLowerCase()
    .replace(/[-\s]+/g, "_");
  return PLAN_STATUS_BY_WORD[word] ?? "pending";
}

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
    .replace(
      /\s*\((?:pending|in[_ -]?progress|completed|cancelled)(?::[^)]*)?\)\s*$/i,
      "",
    )
    .trim();
}

/** The raw tool name a part carries, or undefined for a non-tool part. */
function rawToolName(part: unknown): string | undefined {
  if (!part || typeof part !== "object") return undefined;
  const p = part as { type?: unknown; toolName?: unknown };
  const type = typeof p.type === "string" ? p.type : undefined;
  if (!type) return undefined;
  if (type === "dynamic-tool") {
    return typeof p.toolName === "string" ? p.toolName : undefined;
  }
  if (type.startsWith("tool-")) return type.slice("tool-".length);
  return undefined;
}

/** True when a part is the plan tool (`todowrite`/`todoread`). */
export function isPlanToolPart(part: unknown): boolean {
  const name = rawToolName(part);
  return name !== undefined && PLAN_TOOL_NAMES.has(name.toLowerCase());
}

/** A part's `input`, JSON-decoded when it arrived as a string. */
function partInput(part: unknown): unknown {
  if (!part || typeof part !== "object") return undefined;
  const raw = (part as { input?: unknown }).input;
  if (typeof raw !== "string") return raw;
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

/**
 * Parse a `todowrite` input into a normalised item list, shape-tolerant of the
 * two ways the todos can arrive (`{ todos: [...] }` or a bare array) and of a
 * status the tool never promised. Items without a non-empty content string are
 * dropped — a checklist row with no text is worse than one fewer row. Returns
 * null when there is nothing list-shaped to read.
 */
export function parseTodoList(input: unknown): LangyPlanItem[] | null {
  const raw = todoRows(input);
  if (!raw) return null;

  const items: LangyPlanItem[] = [];
  for (const entry of raw) {
    const item = planItemOf(entry);
    if (item) items.push(item);
  }
  return items;
}

/** The rows a `todowrite` input carries, or null when it is not list-shaped. */
function todoRows(input: unknown): unknown[] | null {
  if (Array.isArray(input)) return input;
  if (!input || typeof input !== "object") return null;
  const todos = (input as { todos?: unknown }).todos;
  return Array.isArray(todos) ? todos : null;
}

/** One row as a plan item, or null when it names no step. */
function planItemOf(entry: unknown): LangyPlanItem | null {
  if (!entry || typeof entry !== "object") return null;
  const row = entry as { content?: unknown; status?: unknown };
  const content =
    typeof row.content === "string" ? cleanPlanContent(row.content) : "";
  if (!content) return null;
  return { content, status: normalisePlanStatus(row.status) };
}

/** Index of the single in-progress item, or -1 (first wins if the model erred). */
function inProgressIndex(items: LangyPlanItem[]): number {
  return items.findIndex((it) => it.status === "in_progress");
}

/** Normalise a wire item (permissive `status` string) into a plan item. */
function normaliseItem(item: {
  content: string;
  status: string;
}): LangyPlanItem {
  return {
    content: cleanPlanContent(item.content),
    status: normalisePlanStatus(item.status),
  };
}

/**
 * The latest valid plan snapshot on a message's tool parts. `todowrite`
 * rewrites the whole list every call, so the last one that parsed is the plan.
 */
function latestPartsSnapshot(
  parts: readonly unknown[],
): LangyPlanItem[] | null {
  let latest: LangyPlanItem[] | null = null;
  for (const part of parts) {
    if (!isPlanToolPart(part)) continue;
    const parsed = parseTodoList(partInput(part));
    if (parsed && parsed.length > 0) latest = parsed;
  }
  return latest;
}

/** How many steps a snapshot has finished. */
function completedCountOf(items: LangyPlanItem[] | null): number {
  return items?.filter((item) => item.status === "completed").length ?? 0;
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
  return completedCountOf(derived) > completedCountOf(override)
    ? derived
    : override;
}

/**
 * Fold a message's tool parts into the plan it was following, or null when the
 * agent never maintained a todo list (⇒ no checklist, today's rendering).
 *
 * The LATEST full list wins: `todowrite` rewrites the whole list every call, so
 * the last valid snapshot is the plan.
 *
 * The plan is the checklist and nothing else. The calls a step made are not
 * filed under it: the transcript already carries every call where it happened
 * (logic/langyTranscript.ts), and a card cannot be in the transcript and inside
 * the checklist at the same time without being read twice.
 */
export function langyPlan(
  message: { parts: readonly unknown[] },
  opts?: {
    /**
     * The manager's typed plan snapshot for the LIVE turn (capped + truncated),
     * or the turn's durable plan for a tab that reloaded mid-turn. It is
     * preferred over parsing the raw todowrite parts, so the client enforces
     * the same caps the manager did, unless the message's own parts carry MORE
     * completed steps, in which case they are the fresher snapshot (see
     * `fresherSnapshot`). Absent (old turns, history) ⇒ tool-part parsing.
     */
    overrideItems?: Array<{ content: string; status: string }> | null;
  },
): LangyPlan | null {
  const derived = latestPartsSnapshot(message.parts ?? []);
  const override =
    opts?.overrideItems && opts.overrideItems.length > 0
      ? opts.overrideItems.map(normaliseItem).filter((it) => it.content)
      : null;

  const items = fresherSnapshot({ override, derived });
  if (!items || items.length === 0) return null;

  const completedCount = items.filter((it) => it.status === "completed").length;
  const totalCount = items.filter((it) => it.status !== "cancelled").length;

  return {
    items,
    currentIndex: inProgressIndex(items),
    completedCount,
    totalCount,
  };
}
