import type { Tokens } from '@chakra-ui/react';


export function formatRelativeTime(timestamp: number): string {
  const diffMs = Date.now() - timestamp;
  const diffMin = Math.floor(diffMs / 60_000);
  if (diffMin < 1) return "now";
  if (diffMin < 60) return `${diffMin}m`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h`;
  return `${Math.floor(diffHr / 24)}d`;
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

export function abbreviateModel(model: string): string {
  const providerMap: Record<string, string> = {
    openai: "oai",
    anthropic: "ant",
    google: "ggl",
  };

  const parts = model.split("/");
  if (parts.length !== 2) return model;

  const [provider, name] = parts as [string, string];
  const shortProvider = providerMap[provider] ?? provider;

  const shortName = name
    .replace("gpt-4o-mini", "4o-mini")
    .replace("gpt-4o", "4o")
    .replace("gpt-5-mini", "5-mini")
    .replace("claude-sonnet-4-20250514", "sonnet-4")
    .replace("claude-haiku-4-5-20251001", "haiku-4.5")
    .replace("gemini-2.5-pro", "2.5-pro")
    .replace("text-embedding-3-small", "emb-3-sm");

  return `${shortProvider}/${shortName}`;
}

export function formatWallClock(startMs: number, endMs: number): string {
  const diff = endMs - startMs;
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

export const SPAN_TYPE_BADGE_STYLES: Record<string, { bg: string; color: string }> = {
  llm: { bg: "blue.subtle", color: "blue.emphasized" },
  agent: { bg: "purple.subtle", color: "purple.emphasized" },
  workflow: { bg: "teal.subtle", color: "teal.emphasized" },
  span: { bg: "gray.subtle", color: "gray.emphasized" },
};

export const SPAN_TYPE_COLORS: Record<string, Tokens["colors"]> = {
  llm: "blue.solid",
  tool: "green.solid",
  agent: "purple.solid",
  rag: "orange.solid",
  guardrail: "yellow.solid",
  evaluation: "teal.solid",
  chain: "gray.solid",
  span: "gray.solid",
  module: "gray.solid",
};

export const STATUS_COLORS: Record<string, Tokens["colors"]> = {
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
const HASH_COLOR_PALETTE: Tokens["colors"][] = [
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
