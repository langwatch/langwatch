// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import { createTenantId, type FoldProjectionStore, type ReplayEvent } from "@langwatch/eventing";
import { nowInstant } from "@langwatch/time";
import { SPAN_RECEIVED_EVENT_TYPE, TRACE_FAILED_EVENT_TYPE } from "@langwatch/trace-contract";
import {
  defineProjectionReplayStep,
  type LaneReplayer,
  type MigrationStep,
} from "@langwatch/upgrade/step";

import type { NurturingTraceDay } from "../../rules/nurturing-trace-day.rules.ts";
import {
  NURTURING_PROJECT_USAGE_PIPELINE_NAME,
  NURTURING_TRACE_DAY_FAILURES_PROJECTION_NAME,
  NURTURING_TRACE_DAY_SPANS_PROJECTION_NAME,
  nurturingTraceDayFailuresFold,
  nurturingTraceDayReplaySince,
  nurturingTraceDaySpansFold,
} from "../nurturing-project-usage.pipeline.ts";

export const TRACE_DAY_SPANS_STEP = "nurturing:replay-trace-day-spans";
export const TRACE_DAY_FAILURES_STEP = "nurturing:replay-trace-day-failures";

const laneOf = (projection: string) => `${NURTURING_PROJECT_USAGE_PIPELINE_NAME}.${projection}`;

/**
 * The trace-day replay steps as nurturing.module.ts declares them, from the same pinned ids and
 * lane constants, replaying from one counting window before `now`; the declaration test compares.
 * Spec: enterprise/modules/nurturing/specs/project-usage.feature
 */
export function traceDayReplayStepsOver(
  replayer: LaneReplayer,
  { now = nowInstant().epochMilliseconds }: Readonly<{ now?: number }> = {},
): MigrationStep[] {
  const since = nurturingTraceDayReplaySince(now);
  return [
    defineProjectionReplayStep({
      id: TRACE_DAY_SPANS_STEP,
      description: "Fills nurturing's trace days from trace's span log, one counting window back.",
      lane: laneOf(NURTURING_TRACE_DAY_SPANS_PROJECTION_NAME),
      since,
      trailingPass: true,
      replayer,
    }),
    defineProjectionReplayStep({
      id: TRACE_DAY_FAILURES_STEP,
      description:
        "Fills nurturing's failed-trace days from trace's trace_failed log, one counting window back.",
      lane: laneOf(NURTURING_TRACE_DAY_FAILURES_PROJECTION_NAME),
      since,
      trailingPass: true,
      replayer,
    }),
  ];
}

/** trace's own pipeline names, as the replay and the live runtime find each fold's owner by. */
export const TRACE_PROCESSING_OWNER = { name: "trace_processing", aggregateType: "trace" };
export const TRACE_MILESTONES_OWNER = {
  name: "trace_project_milestones",
  aggregateType: "trace_project_milestone",
};

/** An OTLP `langwatch.origin` attribute, as trace's span fact carries it. */
const originAttribute = (origin: string) => ({
  key: "langwatch.origin",
  value: { stringValue: origin },
});

/** trace's span_received as its log holds it: a root span unless `parentSpanId` is set. */
export function spanReceived({
  id,
  projectId = "project-1",
  traceId = id,
  createdAt,
  parentSpanId = null,
  origin,
}: Readonly<{
  id: string;
  projectId?: string;
  traceId?: string;
  createdAt: number;
  parentSpanId?: string | null;
  origin?: string;
}>): ReplayEvent {
  return {
    id,
    aggregateId: traceId,
    aggregateType: TRACE_PROCESSING_OWNER.aggregateType,
    tenantId: projectId,
    createdAt,
    timestamp: createdAt,
    occurredAt: createdAt,
    type: SPAN_RECEIVED_EVENT_TYPE,
    version: "2026-11-01",
    idempotencyKey: id,
    data: {
      span: {
        traceId,
        spanId: `${id}-span`,
        parentSpanId,
        attributes: origin ? [originAttribute(origin)] : [],
      },
      resource: { attributes: [] },
    },
  };
}

/** trace's trace_failed as its log holds it, once per trace. */
export function traceFailed({
  id,
  projectId = "project-1",
  traceId = id,
  createdAt,
  origin,
}: Readonly<{
  id: string;
  projectId?: string;
  traceId?: string;
  createdAt: number;
  origin?: string;
}>): ReplayEvent {
  return {
    id,
    aggregateId: `${projectId}:${traceId}`,
    aggregateType: TRACE_MILESTONES_OWNER.aggregateType,
    tenantId: projectId,
    createdAt,
    timestamp: createdAt,
    occurredAt: createdAt,
    type: TRACE_FAILED_EVENT_TYPE,
    version: "2026-11-01",
    idempotencyKey: `${projectId}:trace_failed:${traceId}`,
    data: {
      tenantId: projectId,
      projectId,
      traceId,
      occurredAt: createdAt,
      ...(origin ? { origin } : {}),
    },
  };
}

/**
 * What per-fact live delivery leaves: each fact parsed by the fold's own contract schema, staged
 * only if the fold's enqueue filter takes it, folded into the row its key names and stored, one at
 * a time, as the executor does with no redelivery.
 */
export async function foldLive({
  spans,
  failures,
  facts,
}: Readonly<{
  spans: FoldProjectionStore<NurturingTraceDay>;
  failures: FoldProjectionStore<NurturingTraceDay>;
  facts: readonly ReplayEvent[];
}>): Promise<void> {
  const spansFold = nurturingTraceDaySpansFold(spans);
  const failuresFold = nurturingTraceDayFailuresFold(failures);
  for (const fact of facts) {
    const tenantId = createTenantId(fact.tenantId);
    if (fact.type === SPAN_RECEIVED_EVENT_TYPE) {
      const [{ data: schema }] = spansFold.events;
      const event = {
        ...fact,
        tenantId,
        type: SPAN_RECEIVED_EVENT_TYPE,
        data: schema.parse(fact.data),
      };
      await foldOne({ fold: spansFold.fold, event, tenantId });
    } else {
      const [{ data: schema }] = failuresFold.events;
      const event = {
        ...fact,
        tenantId,
        type: TRACE_FAILED_EVENT_TYPE,
        data: schema.parse(fact.data),
      };
      await foldOne({ fold: failuresFold.fold, event, tenantId });
    }
  }
}

async function foldOne<E>({
  fold,
  event,
  tenantId,
}: Readonly<{
  fold: {
    key?: (event: E) => string;
    options?: { enqueue?: { filter?: (event: E) => boolean } };
    init: () => NurturingTraceDay;
    apply: (state: NurturingTraceDay, event: E) => NurturingTraceDay;
    store: FoldProjectionStore<NurturingTraceDay>;
  };
  event: E;
  tenantId: ReturnType<typeof createTenantId>;
}>): Promise<void> {
  if (fold.options?.enqueue?.filter?.(event) === false) return;
  const key = fold.key?.(event);
  if (key === undefined) throw new Error("a trace-day fold keys every fact");
  const read = await fold.store.get(key, { aggregateId: key, tenantId, key });
  const state = fold.apply(read.kind === "folded" ? read.state : fold.init(), event);
  await fold.store.store(state, { aggregateId: key, tenantId, key, appliedEventIds: [] });
}
