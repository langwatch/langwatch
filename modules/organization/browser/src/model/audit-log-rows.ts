/** How the audit feed reads its rows: a verb phrase per action, an actor per row, runs grouped. */

import type { EnrichedAuditLog } from "@langwatch/organization-contract";
import { format, isSameCalendarDay, subDays, type TimeInput } from "@langwatch/time";

const PAST: Readonly<Record<string, string>> = {
  accept: "Accepted",
  add: "Added",
  approve: "Approved",
  archive: "Archived",
  assign: "Assigned",
  attach: "Attached",
  cancel: "Cancelled",
  change: "Changed",
  clear: "Cleared",
  connect: "Connected",
  copy: "Copied",
  create: "Created",
  deactivate: "Deactivated",
  define: "Defined",
  delete: "Deleted",
  detach: "Detached",
  disable: "Disabled",
  disconnect: "Disconnected",
  duplicate: "Duplicated",
  enable: "Enabled",
  export: "Exported",
  generate: "Generated",
  grant: "Granted",
  import: "Imported",
  install: "Installed",
  invite: "Invited",
  link: "Linked",
  move: "Moved",
  publish: "Published",
  reactivate: "Reactivated",
  regenerate: "Regenerated",
  reject: "Rejected",
  remove: "Removed",
  rename: "Renamed",
  reset: "Reset",
  restore: "Restored",
  revoke: "Revoked",
  rotate: "Rotated",
  run: "Ran",
  save: "Saved",
  send: "Sent",
  set: "Set",
  start: "Started",
  stop: "Stopped",
  sync: "Synced",
  toggle: "Toggled",
  unassign: "Unassigned",
  unlink: "Unlinked",
  update: "Updated",
  upsert: "Saved",
  verify: "Verified",
};

/** `modelProvider` and `role_defined` alike, as lower-case words. */
function words(segment: string): string[] {
  return segment
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .split(/[\s_-]+/)
    .filter(Boolean)
    .map((word) => word.toLowerCase());
}

function singular(word: string): string {
  return word.endsWith("s") && !word.endsWith("ss") ? word.slice(0, -1) : word;
}

function sentence(parts: string[]): string {
  const text = parts.join(" ");
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/**
 * `authz.grants.attach` reads "Attached grant", `gateway.budget.created` "Created budget".
 * An action whose last segment is no known verb reads as its words, so nothing is invented.
 */
export function auditActionPhrase(action: string): string {
  const segments = action.split(".").filter(Boolean);
  const verbWords = words(segments.at(-1) ?? action);
  const noun = words(segments.at(-2) ?? "").map((word, index, all) =>
    index === all.length - 1 ? singular(word) : word,
  );
  const [first = "", ...rest] = verbWords;
  const past = PAST[first];
  if (past) return sentence([past, ...(rest.length > 0 ? rest : noun)]);

  const last = verbWords.at(-1) ?? "";
  if (verbWords.length > 1 && last.endsWith("ed")) {
    return sentence([last, ...verbWords.slice(0, -1)]);
  }
  if (verbWords.length === 1 && last.endsWith("ed")) return sentence([last, ...noun]);
  return sentence([...noun, ...verbWords]);
}

type ActorFields = Pick<EnrichedAuditLog, "userId" | "user" | "actorUserId" | "actorUser">;
type Person = { id: string; name: string; email: string | null };

/** Who a row names. The wire carries no credential kind yet, so these are all it can tell apart. */
export type AuditActor =
  | ({ kind: "user" } & Person)
  | { kind: "impersonation"; operator: Person; subject: Person }
  | { kind: "unresolved"; id: string }
  | { kind: "anonymous" }
  | { kind: "system" };

function person(
  user: { id: string; name: string | null; email: string | null } | null,
  id: string,
): Person {
  return { id, name: user?.name ?? user?.email ?? "Unknown user", email: user?.email ?? null };
}

export function auditActor(log: ActorFields): AuditActor {
  if (log.actorUserId && log.userId && log.actorUserId !== log.userId) {
    return {
      kind: "impersonation",
      operator: person(log.actorUser, log.actorUserId),
      subject: person(log.user, log.userId),
    };
  }
  if (log.user) return { kind: "user", ...person(log.user, log.user.id) };
  if (!log.userId) return { kind: "system" };
  // The REST door records a caller it could not identify under this literal.
  if (log.userId === "anonymous") return { kind: "anonymous" };
  return { kind: "unresolved", id: log.userId };
}

type RunFields = Pick<
  EnrichedAuditLog,
  | "id"
  | "userId"
  | "actorUserId"
  | "action"
  | "targetKind"
  | "targetId"
  | "projectId"
  | "error"
  | "source"
>;

/** One feed entry: consecutive entries by the same actor doing the same thing, newest first. */
export type AuditRun<T> = { id: string; entries: [T, ...T[]] };

function runKey(log: RunFields): string {
  return JSON.stringify([
    log.userId,
    log.actorUserId,
    log.action,
    log.targetKind,
    log.targetId,
    log.projectId,
    log.error,
    log.source,
  ]);
}

/** Folds back-to-back identical events into one run, so a burst of ten reads as "×10". */
export function groupAuditRuns<T extends RunFields>(rows: readonly T[]): AuditRun<T>[] {
  const runs: AuditRun<T>[] = [];
  let previousKey: string | undefined;
  for (const row of rows) {
    const key = runKey(row);
    const current = runs.at(-1);
    if (current && key === previousKey) current.entries.push(row);
    else runs.push({ id: row.id, entries: [row] });
    previousKey = key;
  }
  return runs;
}

/** The feed's day heading: "Today", "Yesterday", else "Oct 8" (with the year when not this one). */
export function auditDayLabel({ at, now }: { at: TimeInput; now: TimeInput }): string {
  if (isSameCalendarDay(at, now)) return "Today";
  if (isSameCalendarDay(at, subDays(now, 1))) return "Yesterday";
  return format(at, "yyyy") === format(now, "yyyy")
    ? format(at, "MMM d")
    : format(at, "MMM d, yyyy");
}

const BROWSERS: readonly [RegExp, string][] = [
  [/Edg\//, "Edge"],
  [/OPR\//, "Opera"],
  [/Firefox\//, "Firefox"],
  [/Chrome\//, "Chrome"],
  [/Version\/[\d.]+.*Safari\//, "Safari"],
  [/^curl\//, "curl"],
  [/python-requests|python-httpx|aiohttp/, "Python"],
  [/Go-http-client/, "Go"],
  [/node|undici/i, "Node.js"],
];

const SYSTEMS: readonly [RegExp, string][] = [
  [/iPhone|iPad/, "iOS"],
  [/Android/, "Android"],
  [/Mac OS X|Macintosh/, "macOS"],
  [/Windows/, "Windows"],
  [/Linux/, "Linux"],
];

/** "Chrome on macOS" from a stored user agent; the first token when nothing is recognised. */
export function auditClient(userAgent: string | null): string | null {
  if (!userAgent) return null;
  const browser = BROWSERS.find(([pattern]) => pattern.test(userAgent))?.[1];
  const system = SYSTEMS.find(([pattern]) => pattern.test(userAgent))?.[1];
  if (browser && system) return `${browser} on ${system}`;
  return browser ?? system ?? userAgent.split(/[\s/]/)[0] ?? null;
}

export type AuditChange = { field: string; from: string; to: string };

function shortValue(value: unknown): string {
  if (value === undefined || value === null) return "none";
  const text = typeof value === "string" ? value : JSON.stringify(value);
  return text.length > 40 ? `${text.slice(0, 39)}…` : text;
}

function record(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? Object.fromEntries(Object.entries(value))
    : {};
}

/** Top-level fields a before/after pair changed: the first `limit` spelled out, others counted. */
export function auditChangeSummary({
  before,
  after,
  limit = 2,
}: {
  before: unknown;
  after: unknown;
  limit?: number;
}): { changes: AuditChange[]; more: number } {
  const was = record(before);
  const now = record(after);
  const changed = [...new Set([...Object.keys(was), ...Object.keys(now)])].filter(
    (key) => JSON.stringify(was[key]) !== JSON.stringify(now[key]),
  );
  return {
    changes: changed.slice(0, limit).map((key) => ({
      field: words(key).join(" "),
      from: shortValue(was[key]),
      to: shortValue(now[key]),
    })),
    more: Math.max(0, changed.length - limit),
  };
}

/** Runs under their day heading, in the order they came (newest first). */
export function auditFeedDays<T extends { createdAt: TimeInput }>({
  runs,
  now,
}: {
  runs: readonly AuditRun<T>[];
  now: TimeInput;
}): { label: string; runs: AuditRun<T>[] }[] {
  const days: { label: string; runs: AuditRun<T>[] }[] = [];
  for (const run of runs) {
    const label = auditDayLabel({ at: run.entries[0].createdAt, now });
    const day = days.at(-1);
    if (day?.label === label) day.runs.push(run);
    else days.push({ label, runs: [run] });
  }
  return days;
}
