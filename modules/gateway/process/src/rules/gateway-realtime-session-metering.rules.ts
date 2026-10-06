/**
 * @see ADR-097
 * How a realtime voice session's usage reports are named, summed and, when none arrived,
 * estimated. Each report is its own spend record, so budgets see a call's spend while it runs.
 */
import type { SpendUsage } from "@langwatch/gateway-contract";

import { EMPTY_SPEND_USAGE } from "./gateway-spend-projection.rules.ts";

/** The request type a usage report's spend record carries. */
export const REALTIME_REPORT_REQUEST_TYPE = "realtime_response";
/** The longest a sanitised report key may be. */
export const REALTIME_REPORT_KEY_MAX_LENGTH = 128;
/** The report key of a closing report that named none. */
export const REALTIME_FINAL_REPORT_KEY = "final";
/** The report key of the estimate recorded for a session that never reported. */
export const REALTIME_ESTIMATE_REPORT_KEY = "estimate";
/** Sessions settled per reconcile tick. */
export const REALTIME_SETTLEMENT_BATCH_SIZE = 25;
/** How recent a report must be for the budget ledger to possibly not hold its debit yet. */
export const REALTIME_LEDGER_LAG_MS = 60_000;
/**
 * How long a usage report waits on the budget read before it answers unknown. The gateway
 * gives the whole report 3 s, so the read leaves room for the writes around it.
 */
export const REALTIME_BUDGET_READ_TIMEOUT_MS = 1_000;
/** The shortest call an estimate assumes. */
export const REALTIME_ESTIMATE_MIN_DURATION_MS = 60_000;
/** The longest call an estimate assumes. */
export const REALTIME_ESTIMATE_MAX_DURATION_MS = 60 * 60_000;
/** Input audio tokens an unreported `realtime` session is assumed to take each second. */
export const REALTIME_ESTIMATE_INPUT_AUDIO_TOKENS_PER_SECOND = 10;
/** Output audio tokens an unreported `realtime` session is assumed to produce per spoken second. */
export const REALTIME_ESTIMATE_OUTPUT_AUDIO_TOKENS_PER_SECOND = 20;
/** The share of an unreported `realtime` call the model is assumed to be speaking. */
export const REALTIME_ESTIMATE_OUTPUT_SHARE = 0.5;
/** Characters an unreported `tts_socket` session is assumed to synthesise each second. */
export const REALTIME_ESTIMATE_TTS_CHARS_PER_SECOND = 15;
/** The duration assumed for each kind when the credential's lifetime is unknown. */
export const REALTIME_ESTIMATE_DEFAULT_DURATION_MS: Readonly<Record<string, number>> = {
  realtime: 600_000,
  live: 600_000,
  tts_socket: 300_000,
  stt_socket: 300_000,
  stt_batch: 300_000,
};
/** The kinds a session past its window is settled for; any other waits on its vendor report. */
export const REALTIME_SETTLED_KINDS = Object.keys(REALTIME_ESTIMATE_DEFAULT_DURATION_MS);

/** How long a gateway-held session may go without a report before it counts as orphaned. */
export const REALTIME_ORPHAN_SILENCE_MS = 3 * 60_000;

/** A report key as it is stored and joined into a spend record id; empty when nothing is left. */
export function sanitiseRealtimeReportKey({ reportKey }: { reportKey: string }): string {
  return reportKey.replace(/[^A-Za-z0-9_-]/g, "").slice(0, REALTIME_REPORT_KEY_MAX_LENGTH);
}

/** The spend record one report is confirmed on. */
export function realtimeReportSpendRecordId({
  sessionId,
  reportKey,
}: {
  sessionId: string;
  reportKey: string;
}): string {
  return `${sessionId}.${reportKey}`;
}

/** Every quantity of a usage, defaulted, in a fixed order. */
function quantityKeys(): (keyof SpendUsage)[] {
  return Object.keys(EMPTY_SPEND_USAGE) as (keyof SpendUsage)[];
}

/** Whether a usage measured nothing at all. */
export function isEmptyRealtimeUsage({ usage }: { usage: Partial<SpendUsage> }): boolean {
  return quantityKeys().every((key) => (usage[key] ?? 0) === 0);
}

/** The quantities of several usages added together. */
export function sumRealtimeUsage({
  usages,
}: {
  usages: readonly Partial<SpendUsage>[];
}): SpendUsage {
  const total: SpendUsage = { ...EMPTY_SPEND_USAGE };
  for (const usage of usages) {
    for (const key of quantityKeys()) total[key] += usage[key] ?? 0;
  }

  return total;
}

/** What a session total still owes once its reports are taken out, never below zero. */
export function remainingRealtimeUsage({
  total,
  reported,
}: {
  total: Partial<SpendUsage>;
  reported: SpendUsage;
}): SpendUsage {
  const remainder: SpendUsage = { ...EMPTY_SPEND_USAGE };
  for (const key of quantityKeys()) {
    remainder[key] = Math.max(0, (total[key] ?? 0) - reported[key]);
  }

  return remainder;
}

/** What a session that never reported is charged; a kind with no rule is not estimated. */
export type RealtimeUsageEstimate =
  | { estimated: true; usage: SpendUsage; durationMs: number }
  | { estimated: false };

/**
 * Estimates the usage of a session that never reported. The call is assumed to have run for
 * the credential's lifetime, clamped to a plausible call.
 */
export function estimateUnreportedRealtimeUsage({
  kind,
  mintedAtMs,
  credentialExpiresAtMs,
}: {
  kind: string | null;
  mintedAtMs: number;
  credentialExpiresAtMs: number | null;
}): RealtimeUsageEstimate {
  const defaultMs = kind === null ? undefined : REALTIME_ESTIMATE_DEFAULT_DURATION_MS[kind];
  if (kind === null || defaultMs === undefined) return { estimated: false };

  const assumedMs = credentialExpiresAtMs === null ? defaultMs : credentialExpiresAtMs - mintedAtMs;
  const durationMs = Math.min(
    REALTIME_ESTIMATE_MAX_DURATION_MS,
    Math.max(REALTIME_ESTIMATE_MIN_DURATION_MS, assumedMs),
  );
  const seconds = Math.round(durationMs / 1000);

  return {
    estimated: true,
    usage: { ...EMPTY_SPEND_USAGE, ...estimatedQuantities({ kind, seconds, durationMs }) },
    durationMs,
  };
}

function estimatedQuantities({
  kind,
  seconds,
  durationMs,
}: {
  kind: string;
  seconds: number;
  durationMs: number;
}): Partial<SpendUsage> {
  switch (kind) {
    case "realtime":
      return {
        input_audio_tokens: seconds * REALTIME_ESTIMATE_INPUT_AUDIO_TOKENS_PER_SECOND,
        output_audio_tokens: Math.round(
          seconds *
            REALTIME_ESTIMATE_OUTPUT_SHARE *
            REALTIME_ESTIMATE_OUTPUT_AUDIO_TOKENS_PER_SECOND,
        ),
      };
    case "tts_socket":
      return { input_chars: seconds * REALTIME_ESTIMATE_TTS_CHARS_PER_SECOND };
    default:
      return { audio_ms: durationMs };
  }
}
