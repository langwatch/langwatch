/**
 * The judge's trace wait settings as a person types them: seconds in, milliseconds stored.
 * @see specs/scenarios/judge-trace-wait-settings.feature
 */

import {
  TRACE_QUIET_PERIOD_MAX_MS,
  TRACE_WAIT_TIMEOUT_MAX_MS,
  TRACE_WAIT_TIMEOUT_MIN_MS,
} from "@langwatch/scenario-contract";

/** What a project with no history waits; a project that measured longer waits more. */
export const DEFAULT_QUIET_PERIOD_SECONDS = 7;
export const DEFAULT_TRACE_WAIT_SECONDS = 30;

/** Both inputs as typed. Blank means unset, so the next level of the chain decides. */
export type JudgeTraceWaitInput = {
  quietPeriodSeconds: string;
  waitTimeoutSeconds: string;
};

export type JudgeTraceWaitMs = {
  traceQuietPeriodMs: number | null;
  traceWaitTimeoutMs: number | null;
};

export type JudgeTraceWaitErrors = {
  quietPeriod?: string;
  waitTimeout?: string;
};

export const EMPTY_JUDGE_TRACE_WAIT_INPUT: JudgeTraceWaitInput = {
  quietPeriodSeconds: "",
  waitTimeoutSeconds: "",
};

type Bounds = { minMs: number; maxMs: number; label: string };

const QUIET_PERIOD_BOUNDS: Bounds = {
  minMs: 0,
  maxMs: TRACE_QUIET_PERIOD_MAX_MS,
  label: "Quiet period",
};

const WAIT_TIMEOUT_BOUNDS: Bounds = {
  minMs: TRACE_WAIT_TIMEOUT_MIN_MS,
  maxMs: TRACE_WAIT_TIMEOUT_MAX_MS,
  label: "Max trace wait",
};

const SECONDS_PATTERN = /^\d+(\.\d+)?$/;

function secondsOf(ms: number | null | undefined): string {
  if (ms === null || ms === undefined) return "";
  return String(ms / 1000);
}

/** The inputs a stored pair of settings reads as. */
export function judgeTraceWaitInputOf({
  traceQuietPeriodMs,
  traceWaitTimeoutMs,
}: {
  traceQuietPeriodMs?: number | null;
  traceWaitTimeoutMs?: number | null;
}): JudgeTraceWaitInput {
  return {
    quietPeriodSeconds: secondsOf(traceQuietPeriodMs),
    waitTimeoutSeconds: secondsOf(traceWaitTimeoutMs),
  };
}

type Parsed = { ok: true; ms: number | null } | { ok: false; message: string };

function parseSeconds({ raw, bounds }: { raw: string; bounds: Bounds }): Parsed {
  const trimmed = raw.trim();
  if (trimmed === "") return { ok: true, ms: null };
  const message = `${bounds.label} must be between ${bounds.minMs / 1000} and ${bounds.maxMs / 1000} seconds`;
  if (!SECONDS_PATTERN.test(trimmed)) return { ok: false, message };
  const ms = Math.round(Number(trimmed) * 1000);
  if (ms < bounds.minMs || ms > bounds.maxMs) return { ok: false, message };
  return { ok: true, ms };
}

/** What each input says it refuses; empty when both are blank or in range. */
export function judgeTraceWaitErrorsOf(input: JudgeTraceWaitInput): JudgeTraceWaitErrors {
  const quietPeriod = quietPeriodSecondsError(input.quietPeriodSeconds);
  const waitTimeout = waitTimeoutSecondsError(input.waitTimeoutSeconds);
  return {
    ...(quietPeriod ? { quietPeriod } : {}),
    ...(waitTimeout ? { waitTimeout } : {}),
  };
}

/** Why the quiet period input is refused, or undefined when it is blank or in range. */
export function quietPeriodSecondsError(raw: string): string | undefined {
  const parsed = parseSeconds({ raw, bounds: QUIET_PERIOD_BOUNDS });
  return parsed.ok ? undefined : parsed.message;
}

/** Why the max trace wait input is refused, or undefined when it is blank or in range. */
export function waitTimeoutSecondsError(raw: string): string | undefined {
  const parsed = parseSeconds({ raw, bounds: WAIT_TIMEOUT_BOUNDS });
  return parsed.ok ? undefined : parsed.message;
}

/** The first refusal, for a surface that shows one problem at a time. */
export function judgeTraceWaitProblemOf(input: JudgeTraceWaitInput): string | null {
  const errors = judgeTraceWaitErrorsOf(input);
  return errors.quietPeriod ?? errors.waitTimeout ?? null;
}

/** The milliseconds a save sends. An input it would refuse reads as unset. */
export function judgeTraceWaitMsOf(input: JudgeTraceWaitInput): JudgeTraceWaitMs {
  const quiet = parseSeconds({ raw: input.quietPeriodSeconds, bounds: QUIET_PERIOD_BOUNDS });
  const wait = parseSeconds({ raw: input.waitTimeoutSeconds, bounds: WAIT_TIMEOUT_BOUNDS });
  return {
    traceQuietPeriodMs: quiet.ok ? quiet.ms : null,
    traceWaitTimeoutMs: wait.ok ? wait.ms : null,
  };
}

/** True when either input holds something, which opens the section on load. */
export function hasJudgeTraceWait(input: JudgeTraceWaitInput): boolean {
  return input.quietPeriodSeconds.trim() !== "" || input.waitTimeoutSeconds.trim() !== "";
}
