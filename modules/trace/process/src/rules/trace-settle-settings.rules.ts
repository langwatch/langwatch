/**
 * A project's recommended verdict-time trace wait, from its own ingest measurements.
 * See specs/scenarios/judge-trace-wait-settings.feature and ADR-097.
 */

import type { TraceSettleSettings } from "@langwatch/trace-contract";

import type { TraceIngestLagSample } from "../repositories/trace-projected-read.repository.ts";

export const DEFAULT_TRACE_WAIT_MS = 30_000;
export const MIN_TRACE_WAIT_MS = 10_000;
export const MAX_TRACE_WAIT_MS = 30_000;
/** The one extra wait the judge may ask for, at the same cap as the first wait. */
export const TRACE_WAIT_EXTENSION_MS = 30_000;
/** The 5s OpenTelemetry batch flush (JS, Python, Go, Java) plus about 2s of ingest and network. */
export const DEFAULT_TRACE_QUIET_PERIOD_MS = 7_000;
export const MIN_ARRIVAL_GAP_MS = 3_000;
export const MAX_ARRIVAL_GAP_MS = 30_000;
/** Fewer traces than this in the last week is no history: the defaults apply. */
export const MIN_INGEST_SAMPLE_COUNT = 20;

export const DEFAULT_TRACE_SETTLE_SETTINGS: TraceSettleSettings = {
  waitTimeoutMs: DEFAULT_TRACE_WAIT_MS,
  waitExtensionMs: TRACE_WAIT_EXTENSION_MS,
  quietPeriodMs: DEFAULT_TRACE_QUIET_PERIOD_MS,
};

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

/** The wait budget: a quarter over the p95 ingest lag plus five seconds, rounded up. */
export function traceWaitFromSample(sample: TraceIngestLagSample | null): number {
  if (!sample || sample.sampleCount < MIN_INGEST_SAMPLE_COUNT) return DEFAULT_TRACE_WAIT_MS;
  const measured = Math.ceil(1.25 * sample.p95LagMs + 5_000);
  return clamp(measured, MIN_TRACE_WAIT_MS, MAX_TRACE_WAIT_MS);
}

/** The quiet period: the default, or the clamped p95 arrival gap when that is longer. */
export function quietPeriodFromSample(sample: TraceIngestLagSample | null): number {
  if (
    !sample ||
    sample.p95ArrivalGapMs === null ||
    sample.arrivalGapSampleCount < MIN_INGEST_SAMPLE_COUNT
  ) {
    return DEFAULT_TRACE_QUIET_PERIOD_MS;
  }
  const gap = clamp(Math.ceil(sample.p95ArrivalGapMs), MIN_ARRIVAL_GAP_MS, MAX_ARRIVAL_GAP_MS);
  return Math.max(DEFAULT_TRACE_QUIET_PERIOD_MS, gap);
}

export function settleSettingsFromSample(sample: TraceIngestLagSample | null): TraceSettleSettings {
  return {
    waitTimeoutMs: traceWaitFromSample(sample),
    waitExtensionMs: TRACE_WAIT_EXTENSION_MS,
    quietPeriodMs: quietPeriodFromSample(sample),
  };
}
