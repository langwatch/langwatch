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

const evaluationMatchFieldsSchema = z.object({
  status: z.string().optional(),
  traceId: z.string().min(1).optional(),
});

type EvaluationMatchEvent = { tenantId: string; aggregateId: string; data: unknown };

/** Where an evaluation event settles: on its trace, or (unsettled or traceless) on itself. */
type EvaluationMatchScope = { kind: "trace"; traceId: string } | { kind: "evaluation" };

function evaluationMatchScopeOf(event: EvaluationMatchEvent): EvaluationMatchScope {
  const parsed = evaluationMatchFieldsSchema.safeParse(event.data);
  if (!parsed.success || !isTerminalEvaluationStatus(parsed.data.status)) {
    return { kind: "evaluation" };
  }
  const { traceId } = parsed.data;
  return traceId === undefined ? { kind: "evaluation" } : { kind: "trace", traceId };
}

/** A settled evaluation that names its trace queues in that trace's group; others in their own. */
export function evaluationMatchGroupKey(event: EvaluationMatchEvent): string {
  const scope = evaluationMatchScopeOf(event);
  return scope.kind === "trace"
    ? `evaluation-trace:${event.tenantId}:${scope.traceId}`
    : `evaluation:${event.tenantId}:${event.aggregateId}`;
}

/**
 * One pending match job per trace: settled evaluations of one trace share an id, so K of them
 * collapse to one. A non-terminal or traceless event keys by its evaluation, so it can never
 * squash (and so hide) a settled one.
 */
export function evaluationMatchDedupeId(input: {
  lane: string;
  event: EvaluationMatchEvent;
}): string {
  const { lane, event } = input;
  const scope = evaluationMatchScopeOf(event);
  const prefix = `subscriber:${lane}:${event.tenantId}`;
  return scope.kind === "trace"
    ? `${prefix}:trace:${scope.traceId}`
    : `${prefix}:${event.aggregateId}`;
}
