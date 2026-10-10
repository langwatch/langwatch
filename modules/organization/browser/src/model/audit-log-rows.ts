/** How the audit table reads its rows: a verb phrase per action, an actor per row, runs grouped. */

import type { EnrichedAuditLog } from "@langwatch/organization-contract";

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

type ActorFields = Pick<EnrichedAuditLog, "userId" | "user">;

/** Who a row names. The wire carries no credential kind yet, so these are all it can tell apart. */
export type AuditActor =
  | { kind: "user"; name: string; email: string | null; id: string }
  | { kind: "unresolved"; id: string }
  | { kind: "anonymous" }
  | { kind: "system" };

export function auditActor(log: ActorFields): AuditActor {
  if (log.user) {
    return {
      kind: "user",
      id: log.user.id,
      name: log.user.name ?? log.user.email ?? "Unknown",
      email: log.user.email,
    };
  }
  if (!log.userId) return { kind: "system" };
  // The REST door records a caller it could not identify under this literal.
  if (log.userId === "anonymous") return { kind: "anonymous" };
  return { kind: "unresolved", id: log.userId };
}

type RunFields = Pick<
  EnrichedAuditLog,
  "id" | "userId" | "action" | "targetKind" | "targetId" | "projectId" | "error" | "source"
>;

/** One table row: consecutive entries by the same actor doing the same thing, newest first. */
export type AuditRun<T> = { id: string; entries: [T, ...T[]] };

function runKey(log: RunFields): string {
  return JSON.stringify([
    log.userId,
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

/** Columns the page shows only when some row on it fills them. */
export function auditOptionalColumns(
  rows: readonly Pick<EnrichedAuditLog, "targetKind" | "targetId" | "projectId">[],
): { target: boolean; project: boolean } {
  return {
    target: rows.some((row) => !!row.targetKind && !!row.targetId),
    project: rows.some((row) => !!row.projectId),
  };
}
