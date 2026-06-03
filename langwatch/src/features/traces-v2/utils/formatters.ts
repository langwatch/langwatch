import type { Tokens } from "@chakra-ui/react";

const MS_PER_SECOND = 1_000;
const MS_PER_MINUTE = 60_000;
const MS_PER_HOUR = 60 * MS_PER_MINUTE;
const MS_PER_DAY = 24 * MS_PER_HOUR;
const MS_PER_WEEK = 7 * MS_PER_DAY;
const MS_PER_MONTH = 30 * MS_PER_DAY;
const MS_PER_YEAR = 365 * MS_PER_DAY;

export function formatRelativeTime(timestamp: number): string {
  const diffMs = Date.now() - timestamp;
  if (diffMs < MS_PER_MINUTE) return "now";
  if (diffMs < MS_PER_HOUR) return `${Math.floor(diffMs / MS_PER_MINUTE)}m`;
  if (diffMs < MS_PER_DAY) return `${Math.floor(diffMs / MS_PER_HOUR)}h`;
  return `${Math.floor(diffMs / MS_PER_DAY)}d`;
}

/**
 * Verbose natural-language relative time — "1 minute ago", "2 hours ago",
 * "3 weeks ago". Used by the SINCE column, which trades compactness for
 * readability (the compact `formatRelativeTime` stays the format for the
 * narrow TIME column).
 */
export function formatVerboseRelative(timestamp: number): string {
  const diffMs = Date.now() - timestamp;
  if (diffMs < 0) return "in the future";
  if (diffMs < MS_PER_MINUTE) return "just now";
  const pick = (
    n: number,
    singular: string,
  ): string => `${n} ${singular}${n === 1 ? "" : "s"} ago`;
  if (diffMs < MS_PER_HOUR) {
    return pick(Math.floor(diffMs / MS_PER_MINUTE), "minute");
  }
  if (diffMs < MS_PER_DAY) {
    return pick(Math.floor(diffMs / MS_PER_HOUR), "hour");
  }
  if (diffMs < MS_PER_WEEK) {
    return pick(Math.floor(diffMs / MS_PER_DAY), "day");
  }
  if (diffMs < MS_PER_MONTH) {
    return pick(Math.floor(diffMs / MS_PER_WEEK), "week");
  }
  if (diffMs < MS_PER_YEAR) {
    return pick(Math.floor(diffMs / MS_PER_MONTH), "month");
  }
  return pick(Math.floor(diffMs / MS_PER_YEAR), "year");
}

/**
 * Full ISO 8601 timestamp in UTC, e.g. `2026-06-02T13:14:15.123Z`. Used by
 * the TIMESTAMP column for users who want to copy-paste a precise wall-
 * clock into log queries / external tools without translating from a
 * relative string.
 */
export function formatISOTimestamp(timestamp: number): string {
  return new Date(timestamp).toISOString();
}

/**
 * Local-time string with the viewer's IANA zone abbreviated (e.g.
 * `2026-06-02 15:14:15 CEST`). Used inside the TimeHoverCard. Falls back
 * gracefully on environments without `Intl` (SSR) — returns the bare
 * locale string.
 */
export function formatLocalWithZone(timestamp: number): string {
  const d = new Date(timestamp);
  try {
    const formatter = new Intl.DateTimeFormat(undefined, {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
      timeZoneName: "short",
    });
    // Intl returns "06/02/2026, 15:14:15 CEST" — reformat to the ISO-ish
    // shape we use elsewhere for consistency with formatAbsoluteTime.
    const parts = formatter.formatToParts(d);
    const lookup: Record<string, string> = {};
    for (const p of parts) lookup[p.type] = p.value;
    const ymd = `${lookup.year}-${lookup.month}-${lookup.day}`;
    const hms = `${lookup.hour}:${lookup.minute}:${lookup.second}`;
    return `${ymd} ${hms} ${lookup.timeZoneName ?? ""}`.trim();
  } catch {
    return d.toLocaleString();
  }
}

/**
 * Resolve the viewer's IANA time zone, e.g. `Europe/Amsterdam`. Returns
 * `"UTC"` when `Intl` isn't available (server render path).
 */
export function resolveViewerTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

/**
 * Day of week in the viewer's locale, e.g. `Tuesday`. Mirrors what most
 * dashboards put in the right-rail of a date hover.
 */
export function formatDayOfWeek(timestamp: number): string {
  try {
    return new Intl.DateTimeFormat(undefined, { weekday: "long" }).format(
      new Date(timestamp),
    );
  } catch {
    return "";
  }
}

/**
 * Compact relative-time formatter with an explicit "ago" suffix for
 * drawer-header / detail surfaces. No space between the number and
 * unit (`10m ago`, `16d ago`) so it stays tight at small sizes, but
 * keeps the natural-language hint that the table-cell
 * `formatRelativeTime` drops.
 */
export function formatRelativeTimeAgo(timestamp: number): string {
  const diffMs = Date.now() - timestamp;
  if (diffMs < MS_PER_MINUTE) return "just now";
  if (diffMs < MS_PER_HOUR) {
    return `${Math.floor(diffMs / MS_PER_MINUTE)}m ago`;
  }
  if (diffMs < MS_PER_DAY) {
    return `${Math.floor(diffMs / MS_PER_HOUR)}h ago`;
  }
  return `${Math.floor(diffMs / MS_PER_DAY)}d ago`;
}

export function formatAbsoluteTime(timestamp: number): string {
  // Render in UTC and tag the suffix so engineers reading a trace can
  // line up timestamps against their server logs without doing the TZ
  // math in their heads. The previous `toLocaleString()` form rendered
  // in the viewer's local time without saying so, which was ambiguous.
  const d = new Date(timestamp);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(
    d.getUTCDate(),
  )} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(
    d.getUTCSeconds(),
  )} UTC`;
}

export function formatDuration(ms: number): string {
  if (ms < 1_000) return `${Math.round(ms)}ms`;
  return `${(ms / 1_000).toFixed(1)}s`;
}

export function formatCost(cost: number, estimated?: boolean): string {
  if (cost === 0) return "—";
  const prefix = estimated ? "~" : "";
  if (cost < 0.01) return `${prefix}$${cost.toFixed(4)}`;
  return `${prefix}$${cost.toFixed(2)}`;
}

export function formatTokens(tokens: number): string {
  if (tokens === 0) return "—";
  if (tokens >= 1_000) return `${(tokens / 1_000).toFixed(1)}K`;
  return `${tokens}`;
}

const MODEL_ABBREVIATIONS: ReadonlyArray<readonly [from: string, to: string]> =
  [
    ["gpt-4o-mini", "4o-mini"],
    ["gpt-4o", "4o"],
    ["gpt-5-mini", "5-mini"],
    ["claude-sonnet-4-20250514", "sonnet-4"],
    ["claude-haiku-4-5-20251001", "haiku-4.5"],
    ["gemini-2.5-pro", "2.5-pro"],
    ["text-embedding-3-small", "emb-3-sm"],
  ];

export function abbreviateModel(model: string): string {
  const slash = model.indexOf("/");
  if (slash < 0) return model;
  const provider = model.slice(0, slash);
  const name = model.slice(slash + 1);
  let shortName = name;
  for (const [from, to] of MODEL_ABBREVIATIONS) {
    shortName = shortName.replace(from, to);
  }
  return `${provider}/${shortName}`;
}

export function formatWallClock(startMs: number, endMs: number): string {
  const diff = Math.max(0, endMs - startMs);
  const secs = Math.floor(diff / 1_000);
  const mins = Math.floor(secs / 60);
  const remainSecs = secs % 60;
  if (mins === 0) return `wall: ${remainSecs}s`;
  return `wall: ${mins}m ${String(remainSecs).padStart(2, "0")}s`;
}

export function truncateId(id: string, chars = 8): string {
  if (id.length <= chars) return id;
  return id.slice(0, chars);
}

export const SPAN_TYPE_BADGE_STYLES: Readonly<
  Record<string, { bg: string; color: string }>
> = {
  llm: { bg: "blue.subtle", color: "blue.emphasized" },
  agent: { bg: "purple.subtle", color: "purple.emphasized" },
  workflow: { bg: "teal.subtle", color: "teal.emphasized" },
  span: { bg: "gray.subtle", color: "gray.emphasized" },
};

export const SPAN_TYPE_COLORS: Readonly<Record<string, Tokens["colors"]>> = {
  llm: "blue.solid",
  tool: "green.solid",
  agent: "purple.solid",
  rag: "teal.solid",
  guardrail: "orange.solid",
  evaluation: "pink.solid",
  chain: "cyan.solid",
  span: "gray.solid",
  module: "gray.solid",
};

export const STATUS_COLORS: Readonly<Record<string, Tokens["colors"]>> = {
  error: "red.solid",
  warning: "yellow.solid",
  ok: "green.solid",
};

/**
 * Origin palette — kept in sync with `~/utils/originColors.ts` so the
 * filter sidebar dots, the Origin table cell, and any chip rendering
 * the trace's origin agree on what colour each origin gets. Picking
 * deterministic mappings (instead of hashing the string) avoids the
 * "evaluation just landed on orange today" surprise that prompted
 * this change.
 */
export const ORIGIN_COLORS: Readonly<Record<string, Tokens["colors"]>> = {
  application: "blue.solid",
  evaluation: "green.solid",
  simulation: "pink.solid",
  workflow: "cyan.solid",
  playground: "teal.solid",
  gateway: "purple.solid",
  sample: "gray.solid",
};

/**
 * Hash palette — deliberately conservative. Each entry is a Chakra colorPalette
 * name whose `.subtle`/`.muted`/`.emphasized` variants render legibly in BOTH
 * light and dark mode. Yellow is excluded because its low-contrast subtle tones
 * are easy to miss against light backgrounds; red is excluded because it carries
 * negative-state semantics elsewhere in the UI (status). Order is fixed so the
 * mapping is stable across deploys.
 */
const HASH_COLOR_PALETTE: ReadonlyArray<Tokens["colors"]> = [
  "blue.solid",
  "purple.solid",
  "pink.solid",
  "orange.solid",
  "teal.solid",
  "cyan.solid",
  "green.solid",
];

export function hashColor(value: string): Tokens["colors"] {
  let hash = 0;
  for (let i = 0; i < value.length; i++) {
    hash = (hash << 5) - hash + value.charCodeAt(i);
    hash |= 0;
  }
  return HASH_COLOR_PALETTE[Math.abs(hash) % HASH_COLOR_PALETTE.length]!;
}
