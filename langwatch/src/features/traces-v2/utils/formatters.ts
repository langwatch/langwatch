import type { Tokens } from "@chakra-ui/react";

const MS_PER_MINUTE = 60_000;
const MS_PER_HOUR = 60 * MS_PER_MINUTE;
const MS_PER_DAY = 24 * MS_PER_HOUR;

export function formatRelativeTime(timestamp: number): string {
  const diffMs = Date.now() - timestamp;
  if (diffMs < MS_PER_MINUTE) return "now";
  if (diffMs < MS_PER_HOUR) return `${Math.floor(diffMs / MS_PER_MINUTE)}m`;
  if (diffMs < MS_PER_DAY) return `${Math.floor(diffMs / MS_PER_HOUR)}h`;
  return `${Math.floor(diffMs / MS_PER_DAY)}d`;
}

export function formatAbsoluteTime(timestamp: number): string {
  return new Date(timestamp).toLocaleString();
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

const PROVIDER_ABBREVIATIONS: Readonly<Record<string, string>> = {
  openai: "oai",
  anthropic: "ant",
  google: "ggl",
};

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
  const shortProvider = PROVIDER_ABBREVIATIONS[provider] ?? provider;
  let shortName = name;
  for (const [from, to] of MODEL_ABBREVIATIONS) {
    shortName = shortName.replace(from, to);
  }
  return `${shortProvider}/${shortName}`;
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
