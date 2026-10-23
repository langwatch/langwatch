// The braid dialog's draft: the condition and its signed-calls switch, the window, the picker.
// Spec: modules/authz/specs/braids-screen.feature, "The dialog builds a braid". Decisions: ADR-185.

import {
  type AuthzBraid,
  type AuthzBraidTargets,
  type BraidConditionCompileResult,
  compileBraidCondition,
} from "@langwatch/authz-contract";
import { Temporal } from "@langwatch/time";

const DAY_MS = 24 * 60 * 60 * 1000;

/** When the reader stops seeing the spans. */
export type BraidEnds =
  | { kind: "never" }
  | { kind: "days"; days: 30 | 90 }
  | { kind: "date"; dateMs: number };

export type BraidDraft = {
  readerProjectId: string | undefined;
  where: string;
  fromMs: number;
  ends: BraidEnds;
};

/** A new braid starts today, never ends, and braids every span until a condition is written. */
export function newBraidDraft({ nowMs }: { nowMs: number }): BraidDraft {
  return {
    readerProjectId: undefined,
    where: "",
    fromMs: startOfDayMs(nowMs),
    ends: { kind: "never" },
  };
}

/** An existing braid, as Edit opens it. */
export function braidDraftOf(braid: AuthzBraid): BraidDraft {
  return {
    readerProjectId: braid.readerProjectId,
    where: braid.where ?? "",
    fromMs: braid.fromMs,
    ends:
      braid.expiresAtMs === null ? { kind: "never" } : { kind: "date", dateMs: braid.expiresAtMs },
  };
}

export function startOfDayMs(ms: number): number {
  return Math.floor(ms / DAY_MS) * DAY_MS;
}

/** The end as the braid stores it; a relative end counts from now. */
export function expiresAtMsOf({ ends, nowMs }: { ends: BraidEnds; nowMs: number }) {
  if (ends.kind === "never") return undefined;
  if (ends.kind === "days") return nowMs + ends.days * DAY_MS;
  return ends.dateMs;
}

/** A `yyyy-mm-dd` value for a date input, in UTC like the braid's window. */
export function dayInputValue(ms: number): string {
  return Temporal.Instant.fromEpochMilliseconds(ms).toString().slice(0, 10);
}

/** The start of the UTC day a date input names, or undefined when it names none. */
export function dayInputMs(value: string): number | undefined {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return undefined;
  try {
    return Temporal.Instant.from(`${value}T00:00:00Z`).epochMilliseconds;
  } catch {
    return undefined;
  }
}

export function checkCondition(where: string): BraidConditionCompileResult {
  return compileBraidCondition({ text: where });
}

/** Whether the draft can be saved: a reader, a supported condition, and an end after now. */
export function braidDraftReady({ draft, nowMs }: { draft: BraidDraft; nowMs: number }): boolean {
  if (!draft.readerProjectId) return false;
  if (!checkCondition(draft.where).ok) return false;
  const expiresAtMs = expiresAtMsOf({ ends: draft.ends, nowMs });
  return expiresAtMs === undefined || expiresAtMs > nowMs;
}

/** Whether an edit saves terms other than the braid it opened; a relative end always does. */
export function braidDraftChanged({
  draft,
  braid,
  nowMs,
}: {
  draft: BraidDraft;
  braid: AuthzBraid;
  nowMs: number;
}): boolean {
  return (
    draft.where.trim() !== (braid.where ?? "").trim() ||
    draft.fromMs !== braid.fromMs ||
    (expiresAtMsOf({ ends: draft.ends, nowMs }) ?? null) !== braid.expiresAtMs
  );
}

const VERIFIED = /Verified\("([^"]*)"\)/;

/** The key `Verified("k")` names in the condition, when it holds one. */
export function verifiedKeyIn(where: string): string | undefined {
  return VERIFIED.exec(where)?.[1];
}

/**
 * The signed entry key the switch adds: the first attribute the condition compares, since
 * that is the tag the reader signs, else the reader's name as a key (ADR-185 §4).
 */
export function signedEntryKey({ where, readerName }: { where: string; readerName: string }) {
  const compared = /(?<!\.)attributes\["([A-Za-z0-9._-]{1,128})"\]/.exec(where);
  if (compared?.[1]) return compared[1];
  const fromName = readerName
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return fromName.slice(0, 128) || "caller";
}

/** Turns only-signed-calls on or off by adding or removing `Verified("k")` in the text. */
export function withSignedCalls({ where, on, key }: { where: string; on: boolean; key: string }) {
  if (on) {
    if (verifiedKeyIn(where) !== undefined) return where;
    const trimmed = where.trim();
    return trimmed.length === 0 ? `Verified("${key}")` : `${trimmed} and Verified("${key}")`;
  }
  return where
    .replace(/\s+and\s+Verified\("[^"]*"\)/g, "")
    .replace(/Verified\("[^"]*"\)\s+and\s+/g, "")
    .replace(/Verified\("[^"]*"\)/g, "")
    .trim();
}

/** Inserts `attributes["k"] == ""` at the cursor, joined by `and`; the caret in its quotes. */
export function insertAttribute({
  where,
  cursor,
  key,
}: {
  where: string;
  cursor: number;
  key: string;
}) {
  const at = Math.max(0, Math.min(cursor, where.length));
  const before = where.slice(0, at);
  const after = where.slice(at);
  const needsAnd = before.trim().length > 0 && !/\b(and|not)\s*$/.test(before);
  const lead = needsAnd ? `${before.replace(/\s*$/, "")} and ` : before;
  const comparison = `attributes["${key.replace(/["\\]/g, "\\$&")}"] == ""`;
  const tail = after.trim().length > 0 && !/^\s/.test(after) ? ` ${after}` : after;
  return { where: `${lead}${comparison}${tail}`, caret: lead.length + comparison.length - 1 };
}

export type BraidTargetOption = {
  projectId: string;
  name: string;
  selectable: boolean;
  /** Why it cannot be picked, in the picker's words. */
  reason?: string;
};

const TARGET_REASONS = {
  this_project: "This project",
  aggregate: "Aggregate projects can't be braided",
} as const;

/** The picker's entries in the host's order, and whether any project was left out. */
export function braidTargetOptions({
  projects,
  targets,
}: {
  projects: readonly { id: string; name: string }[];
  targets: AuthzBraidTargets;
}): { options: BraidTargetOption[]; someLeftOut: boolean } {
  const decided = new Map(targets.map((target) => [target.projectId, target]));
  const options = projects.flatMap((project): BraidTargetOption[] => {
    const target = decided.get(project.id);
    if (!target) return [];
    return [
      {
        projectId: project.id,
        name: project.name,
        selectable: target.selectable,
        ...(target.reason ? { reason: TARGET_REASONS[target.reason] } : {}),
      },
    ];
  });
  return { options, someLeftOut: options.length < projects.length };
}

/** "14 people" or "at least 500 people", as the dialog names who will see the spans. */
export function viewersPhrase({ count, exact }: { count: number; exact: boolean }): string {
  const people = count === 1 ? "1 person" : `${count.toLocaleString("en-GB")} people`;
  return exact ? people : `at least ${people}`;
}

type TestTraceNode = {
  spanId: string;
  parentSpanId: string | null;
  name: string;
  startTimeMs: number;
  ownerProjectId?: string | null;
  braided?: boolean;
};

/** A span of the tested trace: the reader's own, braided in, or withheld by the draft. */
export type TestTraceRow = {
  spanId: string;
  name: string;
  depth: number;
  kind: "own" | "braided" | "withheld";
};

/** The tested trace as a tree, parents before children and siblings by start time. */
export function testTraceRows(nodes: readonly TestTraceNode[]): TestTraceRow[] {
  const ids = new Set(nodes.map((node) => node.spanId));
  const children = new Map<string | null, TestTraceNode[]>();
  for (const node of nodes.toSorted((a, b) => a.startTimeMs - b.startTimeMs)) {
    const parent = node.parentSpanId && ids.has(node.parentSpanId) ? node.parentSpanId : null;
    children.set(parent, [...(children.get(parent) ?? []), node]);
  }
  const rows: TestTraceRow[] = [];
  const walk = (parent: string | null, depth: number) => {
    for (const node of children.get(parent) ?? []) {
      let kind: TestTraceRow["kind"] = "own";
      if (node.ownerProjectId) kind = node.braided === false ? "withheld" : "braided";
      rows.push({ spanId: node.spanId, name: node.name, depth, kind });
      walk(node.spanId, depth + 1);
    }
  };
  walk(null, 0);
  return rows;
}

/** A picker entry's accessible name: the project, and why it is refused when it is. */
export function braidTargetLabel(option: Pick<BraidTargetOption, "name" | "reason">): string {
  if (!option.reason) return option.name;
  return `${option.name}, ${option.reason[0]?.toLowerCase() ?? ""}${option.reason.slice(1)}`;
}

/** The live braids the picked reader already has from this project; an edited one is left out. */
export function braidsOnPair({
  braids,
  readerProjectId,
  editingBraidId,
  nowMs,
}: {
  braids: readonly AuthzBraid[];
  readerProjectId: string | undefined;
  editingBraidId: string | undefined;
  nowMs: number;
}): AuthzBraid[] {
  if (!readerProjectId) return [];
  return braids.filter(
    (braid) =>
      braid.readerProjectId === readerProjectId &&
      braid.braidId !== editingBraidId &&
      (braid.expiresAtMs === null || braid.expiresAtMs > nowMs),
  );
}

export function pairBraidsPhrase({
  readerName,
  ownerName,
  count,
}: {
  readerName: string;
  ownerName: string;
  count: number;
}): string {
  return `${readerName} already sees spans from ${count} ${count === 1 ? "braid" : "braids"} from ${ownerName}`;
}
