/**
 * How long the judge waits for a run's trace at verdict time. Bounds and the plan > scenario >
 * project order are in specs/scenarios/judge-trace-wait-settings.feature.
 */

import type { Named } from "@langwatch/module";
import { z } from "zod";

/** 0 turns the quiet check off; above a minute a verdict stalls longer than any exporter flush. */
export const TRACE_QUIET_PERIOD_MAX_MS = 60_000;
/** Five minutes keeps a verdict well inside the scenario run cap. */
export const TRACE_WAIT_TIMEOUT_MIN_MS = 1_000;
export const TRACE_WAIT_TIMEOUT_MAX_MS = 300_000;

const traceQuietPeriodMsSchemaDefinition = z.number().int().min(0).max(TRACE_QUIET_PERIOD_MAX_MS);
export interface TraceQuietPeriodMsSchema extends Named<
  typeof traceQuietPeriodMsSchemaDefinition
> {}
export const traceQuietPeriodMsSchema: TraceQuietPeriodMsSchema =
  traceQuietPeriodMsSchemaDefinition;

const traceWaitTimeoutMsSchemaDefinition = z
  .number()
  .int()
  .min(TRACE_WAIT_TIMEOUT_MIN_MS)
  .max(TRACE_WAIT_TIMEOUT_MAX_MS);
export interface TraceWaitTimeoutMsSchema extends Named<
  typeof traceWaitTimeoutMsSchemaDefinition
> {}
export const traceWaitTimeoutMsSchema: TraceWaitTimeoutMsSchema =
  traceWaitTimeoutMsSchemaDefinition;

/** A quiet period and trace wait choice at one level of the chain; null or absent is unset. */
export type RunTraceWaitChoice = {
  traceQuietPeriodMs?: number | null;
  traceWaitTimeoutMs?: number | null;
};

export type ResolvedRunTraceWait = {
  traceQuietPeriodMs: number;
  traceWaitTimeoutMs: number;
};

/** Each setting on its own: the plan's, else the scenario's, else the project's recommendation. */
export function resolveRunTraceWait({
  plan,
  scenario,
  project,
}: {
  plan: RunTraceWaitChoice;
  scenario: RunTraceWaitChoice;
  project: ResolvedRunTraceWait;
}): ResolvedRunTraceWait {
  return {
    traceQuietPeriodMs:
      plan.traceQuietPeriodMs ?? scenario.traceQuietPeriodMs ?? project.traceQuietPeriodMs,
    traceWaitTimeoutMs:
      plan.traceWaitTimeoutMs ?? scenario.traceWaitTimeoutMs ?? project.traceWaitTimeoutMs,
  };
}
