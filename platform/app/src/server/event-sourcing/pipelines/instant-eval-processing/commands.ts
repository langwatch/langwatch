/**
 * Every instant-eval-processing command, defined from its event's data schema.
 *
 * Event data schemas are the single source of truth: a command's payload is the
 * envelope (tenantId, occurredAt) plus the event's own data. All five are pure
 * fact recorders, so all five are `defineCommand` with no state read.
 *
 * The aggregate is the RUN, so `aggregateId` is the run id and one run's events
 * fold in order. The queue lane is the TENANT, because judging is the most
 * expensive thing a project can ask for and a hundred concurrent runs of one
 * project would multiply the classifier's load by a hundred; per-tenant is also
 * where the global limiter's fairness bucket already sits.
 *
 * Every idempotency key names the tenant, the domain, the run and the phase, so
 * a redelivered page collapses onto the page it already recorded.
 *
 * @see ./schemas/events.ts
 */

import { defineCommand } from "../../commands/defineCommand";
import {
  INSTANT_EVAL_AGGREGATE_TYPE,
  INSTANT_EVAL_COMMAND_TYPES,
  INSTANT_EVAL_EVENT_TYPES,
  INSTANT_EVAL_EVENT_VERSIONS,
} from "./schemas/constants";
import {
  instantEvalCancelRequestedEventDataSchema,
  instantEvalFinishedEventDataSchema,
  instantEvalPageJudgedEventDataSchema,
  instantEvalPlannedEventDataSchema,
  instantEvalRequestedEventDataSchema,
} from "./schemas/events";

/** Tenant, domain, run and phase, the shape every key here has. */
function runKey({
  tenantId,
  runId,
  phase,
}: {
  tenantId: PropertyKey;
  runId: string;
  phase: string;
}): string {
  return `${String(tenantId)}:instant_eval:${runId}:${phase}`;
}

const groupByTenant = (d: { tenantId: PropertyKey }) => String(d.tenantId);

export const RequestInstantEvalRunCommand = defineCommand({
  commandType: INSTANT_EVAL_COMMAND_TYPES.REQUEST,
  eventType: INSTANT_EVAL_EVENT_TYPES.REQUESTED,
  eventVersion: INSTANT_EVAL_EVENT_VERSIONS.REQUESTED,
  aggregateType: INSTANT_EVAL_AGGREGATE_TYPE,
  schema: instantEvalRequestedEventDataSchema,
  aggregateId: (d) => d.runId,
  groupKey: groupByTenant,
  // One request per run, ever: the run id is minted by the service that
  // accepted it, so a retried send is the same ask rather than a second one.
  idempotencyKey: (d) =>
    runKey({ tenantId: d.tenantId, runId: d.runId, phase: "requested" }),
  spanAttributes: (d) => ({
    "payload.row_limit": d.rowLimit,
    "payload.questions": d.questions.length,
  }),
  makeJobId: (d) =>
    runKey({ tenantId: d.tenantId, runId: d.runId, phase: "requested" }),
});

export const RecordInstantEvalPlannedCommand = defineCommand({
  commandType: INSTANT_EVAL_COMMAND_TYPES.RECORD_PLANNED,
  eventType: INSTANT_EVAL_EVENT_TYPES.PLANNED,
  eventVersion: INSTANT_EVAL_EVENT_VERSIONS.PLANNED,
  aggregateType: INSTANT_EVAL_AGGREGATE_TYPE,
  schema: instantEvalPlannedEventDataSchema,
  aggregateId: (d) => d.runId,
  groupKey: groupByTenant,
  idempotencyKey: (d) =>
    runKey({ tenantId: d.tenantId, runId: d.runId, phase: "planned" }),
  spanAttributes: (d) => ({
    "payload.total": d.total,
    "payload.page_size": d.pageSize,
  }),
  makeJobId: (d) =>
    runKey({ tenantId: d.tenantId, runId: d.runId, phase: "planned" }),
});

/** The page key, shared by the event's idempotency and the enqueue dedup. */
export const instantEvalPageDedupeId = (d: {
  tenantId: PropertyKey;
  runId: string;
  page: number;
}): string =>
  runKey({ tenantId: d.tenantId, runId: d.runId, phase: `page-${d.page}` });

export const RecordInstantEvalPageJudgedCommand = defineCommand({
  commandType: INSTANT_EVAL_COMMAND_TYPES.RECORD_PAGE_JUDGED,
  eventType: INSTANT_EVAL_EVENT_TYPES.PAGE_JUDGED,
  eventVersion: INSTANT_EVAL_EVENT_VERSIONS.PAGE_JUDGED,
  aggregateType: INSTANT_EVAL_AGGREGATE_TYPE,
  schema: instantEvalPageJudgedEventDataSchema,
  aggregateId: (d) => d.runId,
  groupKey: groupByTenant,
  // Keyed by page number, which is what makes a redelivered page collapse
  // instead of counting its rows twice.
  idempotencyKey: instantEvalPageDedupeId,
  spanAttributes: (d) => ({
    "payload.page": d.page,
    "payload.rows": d.rows,
    "payload.matched": d.matched ?? 0,
  }),
  makeJobId: instantEvalPageDedupeId,
});

export const RequestInstantEvalCancelCommand = defineCommand({
  commandType: INSTANT_EVAL_COMMAND_TYPES.REQUEST_CANCEL,
  eventType: INSTANT_EVAL_EVENT_TYPES.CANCEL_REQUESTED,
  eventVersion: INSTANT_EVAL_EVENT_VERSIONS.CANCEL_REQUESTED,
  aggregateType: INSTANT_EVAL_AGGREGATE_TYPE,
  schema: instantEvalCancelRequestedEventDataSchema,
  aggregateId: (d) => d.runId,
  groupKey: groupByTenant,
  // One cancellation per run: asking twice is the same ask, and the second
  // must not restart the grace the first one armed.
  idempotencyKey: (d) =>
    runKey({ tenantId: d.tenantId, runId: d.runId, phase: "cancel" }),
  makeJobId: (d) =>
    runKey({ tenantId: d.tenantId, runId: d.runId, phase: "cancel" }),
});

export const RecordInstantEvalFinishedCommand = defineCommand({
  commandType: INSTANT_EVAL_COMMAND_TYPES.RECORD_FINISHED,
  eventType: INSTANT_EVAL_EVENT_TYPES.FINISHED,
  eventVersion: INSTANT_EVAL_EVENT_VERSIONS.FINISHED,
  aggregateType: INSTANT_EVAL_AGGREGATE_TYPE,
  schema: instantEvalFinishedEventDataSchema,
  aggregateId: (d) => d.runId,
  groupKey: groupByTenant,
  // Not keyed by outcome: a run finishes once, and a stall backstop racing a
  // real finish must collapse onto whichever landed rather than record both.
  idempotencyKey: (d) =>
    runKey({ tenantId: d.tenantId, runId: d.runId, phase: "finished" }),
  spanAttributes: (d) => ({
    "payload.outcome": d.outcome,
    "payload.input_tokens": d.inputTokens,
  }),
  makeJobId: (d) =>
    runKey({ tenantId: d.tenantId, runId: d.runId, phase: "finished" }),
});
