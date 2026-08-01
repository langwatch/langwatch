/**
 * The plan a turn is following, folded from the agent's `todowrite` tool parts.
 *
 * ── WHY THIS EXISTS ─────────────────────────────────────────────────────────
 * Langy's agent keeps a todo list with the `todowrite` tool for multi-step work
 * (AGENTS.md rule 14). opencode's `todowrite` is a WHOLE-LIST REWRITE per call —
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

/** A plan item's lifecycle, mirroring opencode's todo statuses. */
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
  /**
   * The other (non-`todowrite`) tool parts attributed to each item, parallel to
   * `items`: a call belongs to whichever item was uniquely in-progress when the
   * call appeared in the stream. Rendered nested under the current step.
   */
  itemParts: unknown[][];
  /** Tool parts that ran BEFORE any step was current (no plan yet). */
  preamble: unknown[];
}

const PLAN_STATUSES = new Set<LangyPlanItemStatus>([
  "pending",
  "in_progress",
  "completed",
  "cancelled",
]);

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
  const raw = Array.isArray(input)
    ? input
    : input && typeof input === "object"
      ? (input as { todos?: unknown }).todos
      : undefined;
  if (!Array.isArray(raw)) return null;

  const items: LangyPlanItem[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== "object") continue;
    const e = entry as { content?: unknown; status?: unknown };
    const content =
      typeof e.content === "string" ? cleanPlanContent(e.content) : "";
    if (!content) continue;
    const status =
      typeof e.status === "string" &&
      PLAN_STATUSES.has(e.status as LangyPlanItemStatus)
        ? (e.status as LangyPlanItemStatus)
        : "pending";
    items.push({ content, status });
  }
  return items;
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
  const status = PLAN_STATUSES.has(item.status as LangyPlanItemStatus)
    ? (item.status as LangyPlanItemStatus)
    : "pending";
  return { content: cleanPlanContent(item.content), status };
}

/**
 * Fold a message's tool parts into the plan it was following, or null when the
 * agent never maintained a todo list (⇒ no checklist, today's rendering).
 *
 * The LATEST full list wins: `todowrite` rewrites the whole list every call, so
 * the last valid snapshot is the plan. Attribution is TEMPORAL and derived from
 * the snapshot history — we walk the parts in order, tracking which item was
 * in-progress at each point (mapped onto the latest list by content), and file
 * every non-plan tool call under the step that owned it. A call before any step
 * was current lands in the preamble.
 */
export function langyPlan(
  message: { parts: readonly unknown[] },
  opts?: {
    /**
     * The manager's typed plan snapshot for the LIVE turn (capped + truncated).
     * When present it is PREFERRED over parsing the raw todowrite parts — the
     * client then enforces the same caps the manager did. Attribution still
     * derives from the message's todowrite snapshots (by content). Absent (old
     * turns, history) ⇒ Phase-1 tool-part parsing.
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
    const parsed = parseTodoList(partInput(part));
    if (parsed && parsed.length > 0) derived = parsed;
  }

  const override =
    opts?.overrideItems && opts.overrideItems.length > 0
      ? opts.overrideItems.map(normaliseItem).filter((it) => it.content)
      : null;

  const items = override ?? derived;
  if (!items || items.length === 0) return null;

  const itemParts: unknown[][] = items.map(() => []);
  const preamble: unknown[] = [];

  // Walk the stream, tracking which LATEST-list item is currently in-progress.
  let currentItemIndex = -1;
  for (const part of parts) {
    if (isPlanToolPart(part)) {
      const snapshot = parseTodoList(partInput(part));
      if (!snapshot) continue;
      const ip = inProgressIndex(snapshot);
      if (ip !== -1) {
        // Map the snapshot's in-progress item onto the latest list by content:
        // a call made while step 2 ran belongs to step 2 even now that it reads
        // "completed". An item whose text has since changed falls to preamble.
        currentItemIndex = items.findIndex(
          (it) => it.content === snapshot[ip]!.content,
        );
      }
      continue;
    }
    if (rawToolName(part) === undefined) continue; // not a tool call
    if (currentItemIndex >= 0) itemParts[currentItemIndex]!.push(part);
    else preamble.push(part);
  }

  const completedCount = items.filter((it) => it.status === "completed").length;
  const totalCount = items.filter((it) => it.status !== "cancelled").length;

  return {
    items,
    currentIndex: inProgressIndex(items),
    completedCount,
    totalCount,
    itemParts,
    preamble,
  };
}
