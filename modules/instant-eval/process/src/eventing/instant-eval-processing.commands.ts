/**
 * Every Instant Eval command, defined from its event's own data schema. The
 * aggregate is the RUN, so one run's events fold in order; the queue lane is
 * the TENANT. @see specs/instant-evals/instant-eval-pipeline.feature
 */

import { defineCommand } from "@langwatch/eventing";
import {
  INSTANT_EVAL_AGGREGATE_TYPE,
  INSTANT_EVAL_COMMAND_TYPES,
  INSTANT_EVAL_EVENT_TYPES,
  INSTANT_EVAL_EVENT_VERSIONS,
  instantEvalCancelRequestedEventDataSchema,
  instantEvalFinishedEventDataSchema,
  instantEvalPageJudgedEventDataSchema,
  instantEvalPlannedEventDataSchema,
  instantEvalRequestedEventDataSchema,
} from "@langwatch/instant-eval-contract";

/** Tenant, domain, run and phase: the shape every key here has. */
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

const groupByTenant = (data: { tenantId: PropertyKey }): string => String(data.tenantId);

export const RequestInstantEvalRunCommand = defineCommand({
  commandType: INSTANT_EVAL_COMMAND_TYPES.REQUEST,
  eventType: INSTANT_EVAL_EVENT_TYPES.REQUESTED,
  eventVersion: INSTANT_EVAL_EVENT_VERSIONS.REQUESTED,
  aggregateType: INSTANT_EVAL_AGGREGATE_TYPE,
  schema: instantEvalRequestedEventDataSchema,
  aggregateId: (data) => data.runId,
  groupKey: groupByTenant,
  // One request per run, ever: the run id is minted by the service that
  // accepted it, so a retried send is the same ask rather than a second one.
  idempotencyKey: (data) => runKey({ ...data, phase: "requested" }),
  spanAttributes: (data) => ({
    "payload.row_limit": data.rowLimit,
    "payload.questions": data.questions.length,
  }),
  makeJobId: (data) => runKey({ ...data, phase: "requested" }),
});

export const RecordInstantEvalPlannedCommand = defineCommand({
  commandType: INSTANT_EVAL_COMMAND_TYPES.RECORD_PLANNED,
  eventType: INSTANT_EVAL_EVENT_TYPES.PLANNED,
  eventVersion: INSTANT_EVAL_EVENT_VERSIONS.PLANNED,
  aggregateType: INSTANT_EVAL_AGGREGATE_TYPE,
  schema: instantEvalPlannedEventDataSchema,
  aggregateId: (data) => data.runId,
  groupKey: groupByTenant,
  idempotencyKey: (data) => runKey({ ...data, phase: "planned" }),
  spanAttributes: (data) => ({
    "payload.total": data.total,
    "payload.page_size": data.pageSize,
  }),
  makeJobId: (data) => runKey({ ...data, phase: "planned" }),
});

/** The page key, shared by the event's idempotency and the enqueue dedup. */
export function instantEvalPageDedupeId(data: {
  tenantId: PropertyKey;
  runId: string;
  page: number;
}): string {
  return runKey({ ...data, phase: `page-${data.page}` });
}

export const RecordInstantEvalPageJudgedCommand = defineCommand({
  commandType: INSTANT_EVAL_COMMAND_TYPES.RECORD_PAGE_JUDGED,
  eventType: INSTANT_EVAL_EVENT_TYPES.PAGE_JUDGED,
  eventVersion: INSTANT_EVAL_EVENT_VERSIONS.PAGE_JUDGED,
  aggregateType: INSTANT_EVAL_AGGREGATE_TYPE,
  schema: instantEvalPageJudgedEventDataSchema,
  aggregateId: (data) => data.runId,
  groupKey: groupByTenant,
  // Keyed by page number, which is what makes a redelivered page collapse
  // instead of counting its rows twice.
  idempotencyKey: instantEvalPageDedupeId,
  spanAttributes: (data) => ({
    "payload.page": data.page,
    "payload.rows": data.rows,
    "payload.matched": data.matched ?? 0,
  }),
  makeJobId: instantEvalPageDedupeId,
});

export const RequestInstantEvalCancelCommand = defineCommand({
  commandType: INSTANT_EVAL_COMMAND_TYPES.REQUEST_CANCEL,
  eventType: INSTANT_EVAL_EVENT_TYPES.CANCEL_REQUESTED,
  eventVersion: INSTANT_EVAL_EVENT_VERSIONS.CANCEL_REQUESTED,
  aggregateType: INSTANT_EVAL_AGGREGATE_TYPE,
  schema: instantEvalCancelRequestedEventDataSchema,
  aggregateId: (data) => data.runId,
  groupKey: groupByTenant,
  // One cancellation per run: asking twice is the same ask, and the second
  // must not restart the grace the first one armed.
  idempotencyKey: (data) => runKey({ ...data, phase: "cancel" }),
  makeJobId: (data) => runKey({ ...data, phase: "cancel" }),
});

export const RecordInstantEvalFinishedCommand = defineCommand({
  commandType: INSTANT_EVAL_COMMAND_TYPES.RECORD_FINISHED,
  eventType: INSTANT_EVAL_EVENT_TYPES.FINISHED,
  eventVersion: INSTANT_EVAL_EVENT_VERSIONS.FINISHED,
  aggregateType: INSTANT_EVAL_AGGREGATE_TYPE,
  schema: instantEvalFinishedEventDataSchema,
  aggregateId: (data) => data.runId,
  groupKey: groupByTenant,
  // Not keyed by outcome: a run finishes once, and a stall backstop racing a
  // real finish must collapse onto whichever landed rather than record both.
  idempotencyKey: (data) => runKey({ ...data, phase: "finished" }),
  spanAttributes: (data) => ({
    "payload.outcome": data.outcome,
    "payload.input_tokens": data.inputTokens,
  }),
  makeJobId: (data) => runKey({ ...data, phase: "finished" }),
});

/** The five, named as the pipeline registers them and the app sends them. */
export class InstantEvalProcessingCommandsAdapter {
  readonly requestRun = RequestInstantEvalRunCommand;
  readonly recordPlanned = RecordInstantEvalPlannedCommand;
  readonly recordPageJudged = RecordInstantEvalPageJudgedCommand;
  readonly requestCancel = RequestInstantEvalCancelCommand;
  readonly recordFinished = RecordInstantEvalFinishedCommand;

  private constructor() {}

  static create(): InstantEvalProcessingCommandsAdapter {
    return new InstantEvalProcessingCommandsAdapter();
  }
}
