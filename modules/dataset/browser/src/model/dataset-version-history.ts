/**
 * How the history drawer words a dataset version: its label, trigger, author and the
 * values a comparison prints. Spec: modules/dataset/specs/dataset-versioning.feature.
 */

import type { DatasetOutputs } from "@langwatch/dataset-client";

/** One version as the browser receives it (dates as ISO strings). */
export type DatasetVersionListItem = DatasetOutputs["dataset"]["versions"]["versions"][number];

/** One row of a version, or of a comparison list. */
export type DatasetVersionRowItem = { id: string; entry: Record<string, unknown> };

/** One changed row: its values in the version and now. */
export type DatasetVersionChangedRow = {
  id: string;
  before: Record<string, unknown>;
  after: Record<string, unknown>;
};

/** "Version 3", or "Version 3 · Before relabel" when it has a name. */
export function versionTitle(version: { version: number; name: string | null }): string {
  return version.name
    ? `Version ${version.version} · ${version.name}`
    : `Version ${version.version}`;
}

/** What saved the version, in a word or three. */
export function versionTriggerLabel(version: {
  trigger: DatasetVersionListItem["trigger"];
  restoredFromVersion: number | null;
}): string {
  switch (version.trigger) {
    case "autosave":
      return "Autosaved";
    case "manual":
      return "Saved by hand";
    case "experiment_run":
      return "Experiment run";
    case "restore":
      return version.restoredFromVersion
        ? `Restored from version ${version.restoredFromVersion}`
        : "Restored";
    case "initial":
      return "First version";
  }
}

/** Who saved it: "You", a member's name, "API key" or "System". */
export function versionAuthorLabel({
  authorKind,
  authorId,
  authorName,
  currentUserId,
}: {
  authorKind: DatasetVersionListItem["authorKind"];
  authorId: string | null;
  authorName: string | null;
  currentUserId: string | undefined;
}): string {
  if (authorKind === "api_key") return "API key";
  if (authorKind !== "user") return "System";
  if (!authorId) return "Former member";
  if (authorId === currentUserId) return "You";
  return authorName ?? "A team member";
}

/** "Used by 2 runs", "Kept for an experiment", or nothing when neither applies. */
export function versionUsageLabel(version: { pinned: boolean; runCount: number }): string | null {
  if (version.runCount > 0) {
    return version.runCount === 1 ? "Used by 1 run" : `Used by ${version.runCount} runs`;
  }
  return version.pinned ? "Kept for an experiment" : null;
}

/** "1 row", "12 rows". */
export function rowCountLabel(count: number): string {
  return count === 1 ? "1 row" : `${count.toLocaleString("en-GB")} rows`;
}

/** Why a version cannot be restored, or null when it can. */
export function restoreBlockedReason({
  version,
  latestVersion,
  restoreSupported,
  canManage,
}: {
  version: number;
  latestVersion: number | undefined;
  restoreSupported: boolean;
  canManage: boolean;
}): string | null {
  if (!canManage) return "You need permission to manage this dataset to restore a version.";
  if (!restoreSupported) {
    return "This dataset uses the older single-file layout. Copy it to a new dataset to restore versions.";
  }
  if (version === latestVersion) return "This is the latest version.";
  return null;
}

/** A version table's column order: its saved columns, then any extra keys the rows hold. */
export function versionColumnNames({
  columns,
  rows,
}: {
  columns: readonly { name: string }[];
  rows: readonly DatasetVersionRowItem[];
}): string[] {
  const names = columns.map((column) => column.name);
  const seen = new Set(names);
  for (const row of rows) {
    for (const key of Object.keys(row.entry)) {
      if (seen.has(key)) continue;
      seen.add(key);
      names.push(key);
    }
  }
  return names;
}

/** A cell's value as one line of text; empty values read as an empty string. */
export function formatVersionCellValue(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return JSON.stringify(value);
}

/** The columns whose values differ between a row's two states, in the order they first appear. */
export function changedColumnNames(row: DatasetVersionChangedRow): string[] {
  const keys = [...new Set([...Object.keys(row.before), ...Object.keys(row.after)])];
  return keys.filter(
    (key) => formatVersionCellValue(row.before[key]) !== formatVersionCellValue(row.after[key]),
  );
}

const ROW_LABEL_MAX = 60;

/** A changed row named by its first non-empty value, so its column changes read as one group. */
export function changedRowLabel(row: DatasetVersionChangedRow): string {
  const values = [...Object.values(row.after), ...Object.values(row.before)];
  const first = values.map(formatVersionCellValue).find((value) => value.trim() !== "");
  if (!first) return "Row with no values";
  const line = first.replace(/\s+/g, " ").trim();
  return line.length > ROW_LABEL_MAX ? `${line.slice(0, ROW_LABEL_MAX - 1)}…` : line;
}

/** The confirmation a save shows: a new version, a name given to the latest, or nothing to save. */
export function savedVersionNotice({
  saved,
  previousLatest,
}: {
  saved: { version: number; name: string | null };
  previousLatest: number | undefined;
}): { title: string; description?: string } {
  if (saved.version !== previousLatest) return { title: `Saved version ${saved.version}` };
  if (saved.name) {
    return {
      title: `Named version ${saved.version}`,
      description: "Nothing changed since it was saved, so no new version was needed.",
    };
  }
  return { title: `No changes since version ${saved.version}` };
}

/** The confirmation a restore shows. */
export function restoredVersionNotice({
  version,
  restored,
}: {
  version: number;
  restored: { changed: boolean; version: { version: number } };
}): { title: string; description: string } {
  if (!restored.changed) {
    return {
      title: "Nothing to restore",
      description: `The dataset already matches version ${version}.`,
    };
  }
  return {
    title: `Restored version ${version}`,
    description: `Saved as version ${restored.version.version}.`,
  };
}
