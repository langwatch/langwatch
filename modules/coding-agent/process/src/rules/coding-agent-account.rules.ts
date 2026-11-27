import {
  ACCOUNT_ID_ATTRIBUTE,
  ACCOUNT_LIMITED_UNTIL_ATTRIBUTE,
  ACCOUNT_NAME_ATTRIBUTE,
  ACCOUNT_SOURCE_ATTRIBUTE,
  ACCOUNT_USAGE_PERCENT_ATTRIBUTE,
  ACCOUNT_USAGE_READ_AT_ATTRIBUTE,
  ACCOUNT_USAGE_RESETS_AT_ATTRIBUTE,
  ACCOUNT_USAGE_WINDOW_ATTRIBUTE,
  AGENT_ACCOUNT_ID_KEYS,
  type CodingAgentAccountBurndown,
  type CodingAgentAccountColumns,
  type CodingAgentAccountDay,
  type CodingAgentAccountReading,
  type ContributionFacts,
  NO_ACCOUNT_COLUMNS,
} from "@langwatch/coding-agent-contract";
import { Temporal } from "@langwatch/time";

import type { AccountUsageGroupRow } from "../repositories/coding-agent-session-event.repository.ts";

type FactValue = ContributionFacts[string] | undefined;

/**
 * Where an account's id comes from, first match wins: the launcher's own id, then the ids the
 * agents send themselves (Claude Code's account uuid, Codex's account id). Never an email.
 */
const ACCOUNT_KEY_FACTS = [ACCOUNT_ID_ATTRIBUTE, ...AGENT_ACCOUNT_ID_KEYS];

/** The most models a card names. */
const TOP_MODEL_COUNT = 3;

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * The account columns one row carries; a row with no account id carries none of them. A reading
 * needs a percent, a reset or a limit; a window or read time alone is not stored, so the read's
 * newest reading never lands on a report that says nothing.
 */
export function accountColumnsOf(facts: ContributionFacts): CodingAgentAccountColumns {
  const accountId = ACCOUNT_KEY_FACTS.map((key) => text(facts[key])).find((id) => id !== "");
  if (accountId === undefined) return NO_ACCOUNT_COLUMNS;
  const accountUsagePercent = parsePercent(facts[ACCOUNT_USAGE_PERCENT_ATTRIBUTE]) ?? null;
  const accountUsageResetsAtMs = parseInstant(facts[ACCOUNT_USAGE_RESETS_AT_ATTRIBUTE]) ?? null;
  const accountLimitedUntilMs = parseInstant(facts[ACCOUNT_LIMITED_UNTIL_ATTRIBUTE]) ?? null;
  const isReading =
    accountUsagePercent !== null ||
    accountUsageResetsAtMs !== null ||
    accountLimitedUntilMs !== null;

  return {
    accountId,
    accountName: text(facts[ACCOUNT_NAME_ATTRIBUTE]),
    accountSource: text(facts[ACCOUNT_SOURCE_ATTRIBUTE]),
    accountUsagePercent,
    accountUsageWindow: isReading ? text(facts[ACCOUNT_USAGE_WINDOW_ATTRIBUTE]) : "",
    accountUsageResetsAtMs,
    accountUsageReadAtMs: isReading
      ? (parseInstant(facts[ACCOUNT_USAGE_READ_AT_ATTRIBUTE]) ?? null)
      : null,
    accountLimitedUntilMs,
  };
}

/** The name a card shows for an account its owner never named: a short form of its id. */
export function shortAccountName(accountId: string): string {
  return `Account ${accountId.replaceAll("-", "").slice(0, 8)}`;
}

/** The UTC days of a week ending on `nowMs`'s day, oldest first, and when the first one starts. */
export function accountWeekWindow(nowMs: number): { fromMs: number; days: string[] } {
  const todayStartMs = Math.floor(nowMs / DAY_MS) * DAY_MS;
  const fromMs = todayStartMs - 6 * DAY_MS;
  const days = Array.from({ length: 7 }, (_, index) => utcDayOf(fromMs + index * DAY_MS));

  return { fromMs, days };
}

/** `2026-11-26` for any instant on that UTC day. */
export function utcDayOf(ms: number): string {
  return Temporal.Instant.fromEpochMilliseconds(ms).toString().slice(0, 10);
}

/**
 * One card per account out of the grouped rows: tokens and cost per day, the newest name and
 * source, and the newest reading. A limit that has already passed is no longer shown.
 */
export function buildAccountBurndowns({
  groups,
  days,
  canSeeCosts,
  nowMs,
}: {
  groups: readonly AccountUsageGroupRow[];
  days: readonly string[];
  canSeeCosts: boolean;
  nowMs: number;
}): CodingAgentAccountBurndown[] {
  const byAccount = new Map<string, AccountUsageGroupRow[]>();
  for (const group of groups) {
    byAccount.set(group.accountId, [...(byAccount.get(group.accountId) ?? []), group]);
  }

  return [...byAccount]
    .map(([accountId, rows]) => buildOne({ accountId, rows, days, canSeeCosts, nowMs }))
    .toSorted((left, right) => left.name.localeCompare(right.name));
}

function buildOne({
  accountId,
  rows,
  days,
  canSeeCosts,
  nowMs,
}: {
  accountId: string;
  rows: readonly AccountUsageGroupRow[];
  days: readonly string[];
  canSeeCosts: boolean;
  nowMs: number;
}): CodingAgentAccountBurndown {
  const dayRows = days.map((day) => sumDay({ day, rows, canSeeCosts }));
  const totals = dayRows.reduce(
    (sum, day) => ({
      inputTokens: sum.inputTokens + day.inputTokens,
      outputTokens: sum.outputTokens + day.outputTokens,
      cacheReadTokens: sum.cacheReadTokens + day.cacheReadTokens,
      cacheWriteTokens: sum.cacheWriteTokens + day.cacheWriteTokens,
      costUsd: sum.costUsd + (day.costUsd ?? 0),
    }),
    { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, costUsd: 0 },
  );

  return {
    accountId,
    name: pickNewest(rows.map((row) => row.name))?.value ?? shortAccountName(accountId),
    source: pickNewest(rows.map((row) => row.source))?.value ?? null,
    agents: [...new Set(rows.map((row) => row.agent).filter((agent) => agent !== ""))].toSorted(),
    topModels: topModelsOf(rows),
    days: dayRows,
    totals: {
      ...totals,
      totalTokens:
        totals.inputTokens + totals.outputTokens + totals.cacheReadTokens + totals.cacheWriteTokens,
      costUsd: canSeeCosts ? totals.costUsd : null,
    },
    reading: buildReading({ rows, nowMs }) ?? null,
    rateLimitEvents: rows.reduce((sum, row) => sum + row.rateLimitEvents, 0),
  };
}

function sumDay({
  day,
  rows,
  canSeeCosts,
}: {
  day: string;
  rows: readonly AccountUsageGroupRow[];
  canSeeCosts: boolean;
}): CodingAgentAccountDay {
  const onDay = rows.filter((row) => row.day === day);
  const sum = (pick: (row: AccountUsageGroupRow) => number) =>
    onDay.reduce((total, row) => total + pick(row), 0);

  return {
    day,
    inputTokens: sum((row) => row.inputTokens),
    outputTokens: sum((row) => row.outputTokens),
    cacheReadTokens: sum((row) => row.cacheReadTokens),
    cacheWriteTokens: sum((row) => row.cacheWriteTokens),
    costUsd: canSeeCosts ? sum((row) => row.costUsd) : null,
  };
}

function topModelsOf(rows: readonly AccountUsageGroupRow[]): string[] {
  const tokensByModel = new Map<string, number>();
  for (const row of rows) {
    if (row.model === "") continue;
    const tokens = row.inputTokens + row.outputTokens + row.cacheReadTokens + row.cacheWriteTokens;
    tokensByModel.set(row.model, (tokensByModel.get(row.model) ?? 0) + tokens);
  }

  return [...tokensByModel]
    .toSorted((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .slice(0, TOP_MODEL_COUNT)
    .map(([model]) => model);
}

function buildReading({
  rows,
  nowMs,
}: {
  rows: readonly AccountUsageGroupRow[];
  nowMs: number;
}): CodingAgentAccountReading | undefined {
  const latest = pickNewest(rows.map((row) => row.reading));
  if (latest === undefined) return void 0;
  const { atMs: _atMs, ...reading } = latest;
  const stillLimited = reading.limitedUntilMs !== null && reading.limitedUntilMs > nowMs;

  return { ...reading, limitedUntilMs: stillLimited ? reading.limitedUntilMs : null };
}

function pickNewest<T extends { atMs: number }>(values: readonly (T | null)[]): T | undefined {
  return values
    .filter((value): value is T => value !== null)
    .toSorted((left, right) => right.atMs - left.atMs)[0];
}

function text(value: FactValue): string {
  return typeof value === "string" ? value.trim() : "";
}

function parsePercent(value: FactValue): number | undefined {
  const parsed = typeof value === "string" && value.trim() !== "" ? Number(value) : value;
  if (typeof parsed !== "number" || !Number.isFinite(parsed)) return void 0;

  return Math.min(100, Math.max(0, parsed));
}

/** The instants a usage report may name, 2000-01-01 to 2100-01-01 UTC, so the column holds it. */
const EARLIEST_INSTANT_MS = 946_684_800_000;
const LATEST_INSTANT_MS = 4_102_444_800_000;

/** Epoch seconds, milliseconds, microseconds or nanoseconds, told apart by size. */
function epochMsOf(value: number): number {
  if (value >= 1e17) return Math.trunc(value / 1e6);
  if (value >= 1e14) return Math.trunc(value / 1e3);
  if (value < 1e11) return Math.trunc(value * 1e3);
  return Math.trunc(value);
}

function isInInstantRange(ms: number): boolean {
  return ms >= EARLIEST_INSTANT_MS && ms < LATEST_INSTANT_MS;
}

/** An ISO 8601 instant or an epoch number in any unit, inside the range; else not reported. */
function parseInstant(value: FactValue): number | undefined {
  let ms: number;
  if (typeof value === "number") {
    if (!Number.isFinite(value) || value <= 0) return void 0;
    ms = epochMsOf(value);
  } else {
    if (typeof value !== "string" || value.trim() === "") return void 0;
    try {
      ms = Temporal.Instant.from(value.trim()).epochMilliseconds;
    } catch {
      return void 0;
    }
  }
  return isInInstantRange(ms) ? ms : void 0;
}
