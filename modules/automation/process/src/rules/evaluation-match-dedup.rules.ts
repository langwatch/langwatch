import { z } from "zod";

const TERMINAL_EVALUATION_STATUSES: ReadonlySet<string> = new Set([
  "processed",
  "error",
  "skipped",
]);

/** Only a settled evaluation can match a trigger; anything earlier is still running. */
export function isTerminalEvaluationStatus(status: string | undefined): boolean {
  return status !== undefined && TERMINAL_EVALUATION_STATUSES.has(status);
}

const EVALUATION_MATCH_FRESHNESS_MS = 60 * 60 * 1000;

/** Stale by processing time: a monitor evaluation's occurredAt is its span end (business time). */
export function isStaleEvaluationEvent(input: {
  event: { occurredAt: number; createdAt?: number };
  now: number;
}): boolean {
  const processedAt = input.event.createdAt ?? input.event.occurredAt;
  return processedAt < input.now - EVALUATION_MATCH_FRESHNESS_MS;
}

const evaluationMatchFieldsSchema = z.object({
  status: z.string().optional(),
  traceId: z.string().min(1).optional(),
});

type EvaluationMatchEvent = {
  tenantId: string;
  aggregateId: string;
  occurredAt: number;
  createdAt?: number;
  data: unknown;
};

/** Where an evaluation event settles: on its trace, or (unsettled, stale, traceless) on itself. */
type EvaluationMatchScope = { kind: "trace"; traceId: string } | { kind: "evaluation" };

function evaluationMatchScopeOf(input: {
  event: EvaluationMatchEvent;
  now: number;
}): EvaluationMatchScope {
  const { event, now } = input;
  if (isStaleEvaluationEvent({ event, now })) return { kind: "evaluation" };
  const parsed = evaluationMatchFieldsSchema.safeParse(event.data);
  if (!parsed.success || !isTerminalEvaluationStatus(parsed.data.status)) {
    return { kind: "evaluation" };
  }
  const { traceId } = parsed.data;
  return traceId === undefined ? { kind: "evaluation" } : { kind: "trace", traceId };
}

/** A settled evaluation that names its trace queues in that trace's group; others in their own. */
export function evaluationMatchGroupKey(input: {
  event: EvaluationMatchEvent;
  now: number;
}): string {
  const { event } = input;
  const scope = evaluationMatchScopeOf(input);
  return scope.kind === "trace"
    ? `evaluation-trace:${event.tenantId}:${scope.traceId}`
    : `evaluation:${event.tenantId}:${event.aggregateId}`;
}

/**
 * One pending match job per trace: settled evaluations of one trace share an id, so K of them
 * collapse to one. A non-terminal, stale or traceless event keys by its evaluation, so it can
 * never squash (and so hide) a fresh settled one.
 */
export function evaluationMatchDedupeId(input: {
  lane: string;
  event: EvaluationMatchEvent;
  now: number;
}): string {
  const { lane, event, now } = input;
  const scope = evaluationMatchScopeOf({ event, now });
  const prefix = `subscriber:${lane}:${event.tenantId}`;
  return scope.kind === "trace"
    ? `${prefix}:trace:${scope.traceId}`
    : `${prefix}:${event.aggregateId}`;
}
