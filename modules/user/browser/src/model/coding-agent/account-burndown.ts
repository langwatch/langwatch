import type { CodingAgentAccountDay } from "@langwatch/coding-agent-contract";
import { format, toZonedDateTime } from "@langwatch/time";

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;

const AGENT_LABELS: Readonly<Record<string, string>> = {
  claude_code: "Claude Code",
  claude_cowork: "Claude Cowork",
  codex: "Codex",
  gemini_cli: "Gemini CLI",
  opencode: "opencode",
  copilot: "Copilot",
  grok: "Grok",
  pi: "pi",
};

const WINDOW_LABELS: Readonly<Record<string, string>> = {
  five_hour: "5 hour window",
  seven_day: "weekly window",
  seven_day_opus: "weekly Opus window",
  seven_day_sonnet: "weekly Sonnet window",
};

const SOURCE_LABELS: Readonly<Record<string, string>> = {
  personal: "Personal login",
  pool: "Shared pool",
  computer: "Computer login",
};

/** Every token a day's calls used, across the four buckets. */
export function dayTokens(day: CodingAgentAccountDay): number {
  return day.inputTokens + day.outputTokens + day.cacheReadTokens + day.cacheWriteTokens;
}

/** The running total of tokens, one point per day, oldest first. */
export function cumulativeTokens(days: readonly CodingAgentAccountDay[]): number[] {
  let total = 0;

  return days.map((day) => {
    total += dayTokens(day);
    return total;
  });
}

export function agentLabel(agent: string): string {
  return AGENT_LABELS[agent] ?? agent;
}

export function usageWindowLabel(window: string | null): string | null {
  if (window === null) return null;
  return WINDOW_LABELS[window] ?? window.replaceAll("_", " ");
}

export function accountSourceLabel(source: string | null): string | null {
  if (source === null) return null;
  return SOURCE_LABELS[source] ?? source;
}

/** "72%", rounded, as the provider reported it. */
export function formatUsagePercent(percent: number): string {
  return `${Math.round(percent)}%`;
}

/** "Fri 28 Nov, 09:00" in the reader's time zone. */
export function formatAccountMoment(ms: number): string {
  const weekday = WEEKDAYS[toZonedDateTime(ms).dayOfWeek - 1] ?? "";

  return `${weekday} ${format(ms, "d MMM, HH:mm")}`;
}

/** When an account is out of usage until: the time alone when that is later today. */
export function formatLimitMoment(ms: number, nowMs: number): string {
  if (format(ms, "yyyy-MM-dd") === format(nowMs, "yyyy-MM-dd")) return format(ms, "HH:mm");

  return formatAccountMoment(ms);
}

/** "26 Nov" for a `2026-11-26` UTC day. */
export function formatAccountDay(day: string): string {
  return format(`${day}T12:00:00Z`, "d MMM", { timeZone: "UTC" });
}
