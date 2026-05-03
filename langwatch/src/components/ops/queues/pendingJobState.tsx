import type { JobState } from "~/server/app-layer/ops/types";

export const STATE_LABEL: Record<JobState, string> = {
  ready: "Ready",
  scheduled: "Scheduled",
  retrying: "Retrying",
  active: "Active",
  blocked: "Blocked",
  stale: "Stale",
};

export const STATE_COLOR: Record<JobState, string> = {
  ready: "blue",
  scheduled: "purple",
  retrying: "orange",
  active: "green",
  blocked: "red",
  stale: "yellow",
};

const UNKNOWN_VALUES = new Set([null, undefined, "", "unknown"]);

export function displayLabel(value: string | null | undefined): string {
  return UNKNOWN_VALUES.has(value as string | null | undefined)
    ? "(unknown)"
    : (value as string);
}

export function isUnknown(value: string | null | undefined): boolean {
  return UNKNOWN_VALUES.has(value as string | null | undefined);
}
