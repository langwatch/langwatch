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
  type CodingAgentAccountColumns,
  type ContributionFacts,
  NO_ACCOUNT_COLUMNS,
} from "@langwatch/coding-agent-contract";
import { Temporal } from "@langwatch/time";

type FactValue = ContributionFacts[string] | undefined;

/**
 * Where an account's id comes from, first match wins: the launcher's own id, then the ids the
 * agents send themselves (Claude Code's account uuid, Codex's account id). Never an email.
 */
const ACCOUNT_KEY_FACTS = [ACCOUNT_ID_ATTRIBUTE, ...AGENT_ACCOUNT_ID_KEYS];

/**
 * The account columns one row carries; a row with no account id carries none of them. A reading
 * needs a percent, a reset or a limit; a window or read time alone is not stored, so a query for
 * the newest reading never lands on a report that says nothing.
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

/** A fact as text: a string trimmed, a finite number written out (numeric account ids), else ''. */
function text(value: FactValue): string {
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : "";
  return typeof value === "string" ? value.trim() : "";
}

/** A usage percent, as a number or a numeric string; one outside 0 to 100 is not a reading. */
function parsePercent(value: FactValue): number | undefined {
  const parsed = typeof value === "string" && value.trim() !== "" ? Number(value) : value;
  if (typeof parsed !== "number" || !Number.isFinite(parsed)) return void 0;

  return parsed >= 0 && parsed <= 100 ? parsed : void 0;
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
