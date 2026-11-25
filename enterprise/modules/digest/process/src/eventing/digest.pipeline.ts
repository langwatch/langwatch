// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * The owners' events, folded into weeks. Digest's own subscribers listen on each owner's
 * pipeline (§9) and send its record commands. Only projects of enrolled organizations fold.
 * Design: dev/docs/plans/weekly-digest.md
 */
import {
  METRIC_FACTS_CONTRIBUTED_EVENT_TYPE,
  metricFactsContributionSchema,
  SPAN_FACTS_CONTRIBUTED_EVENT_TYPE,
  spanFactsContributionSchema,
} from "@langwatch/coding-agent-contract";
import {
  EVALUATION_LIFECYCLE_COMPLETED_EVENT_TYPE,
  evaluationLifecycleCompletedEventDataSchema,
} from "@langwatch/evaluation-contract";
import {
  defineAggregate,
  defineEventingModule,
  definePipeline,
  type EventingSetup,
  type StateProjectionStore,
} from "@langwatch/eventing";
import {
  SIMULATION_RUN_EVENT_TYPES,
  simulationRunFinishedEventDataSchema,
} from "@langwatch/scenario-contract";
import {
  recordTraceSpanEventDataSchema,
  SPAN_RECORDED_EVENT_TYPE,
} from "@langwatch/trace-contract";
import { USER_ERASED_EVENT_TYPE, userErasedEventDataSchema } from "@langwatch/user-contract";

import type { DigestModule } from "../app/digest.app.ts";
import type { DigestRepositories } from "../repositories/digest.repositories.ts";
import type { ProjectWeekState, UserWeekState } from "../rules/digest-week.rules.ts";
import type { DigestSourceService } from "../services/digest-source.service.ts";
import type { DigestUserErasureService } from "../services/digest-user-erasure.service.ts";
import {
  RecordProjectActivityCommand,
  RecordUserActivityCommand,
} from "./digest-activity.commands.ts";
import {
  DIGEST_ACTIVITY_COALESCE_MAX_BATCH,
  DIGEST_PIPELINE_NAME,
  DIGEST_WEEK_AGGREGATE_TYPE,
  projectActivityRecordedEventSchema,
  userActivityRecordedEventSchema,
} from "./digest-activity.events.ts";
import { projectWeekProjection, userWeekProjection } from "./digest-week.projection.ts";

/** A redelivered owner fact carries the same source key; its second send is dropped. */
const REDELIVERY_WINDOW_MS = 60 * 60 * 1000;

type Source = Pick<
  DigestSourceService,
  | "mayFold"
  | "spanRecorded"
  | "evaluationCompleted"
  | "scenarioFinished"
  | "codingAgentSpan"
  | "codingAgentMetric"
>;

function digestActivity(deps: {
  projectWeeks: StateProjectionStore<ProjectWeekState>;
  userWeeks: StateProjectionStore<UserWeekState>;
  source: Source;
  erasure: Pick<DigestUserErasureService, "forgetUser">;
}) {
  const appendOptions = {
    coalesceMaxBatch: DIGEST_ACTIVITY_COALESCE_MAX_BATCH,
    deduplication: {
      makeId: (payload: { sourceKey: string }) => payload.sourceKey,
      ttlMs: REDELIVERY_WINDOW_MS,
      extend: false,
      replace: false,
      shouldSurviveDispatch: true,
    },
  };
  return (
    definePipeline({
      name: DIGEST_PIPELINE_NAME,
      aggregate: defineAggregate({ type: DIGEST_WEEK_AGGREGATE_TYPE }),
    })
      .withEvents([projectActivityRecordedEventSchema, userActivityRecordedEventSchema])
      .withPostgresProjection(projectWeekProjection({ store: deps.projectWeeks }))
      .withPostgresProjection(userWeekProjection({ store: deps.userWeeks }))
      // Every recorded span reaches this lane: the filter keeps jobs to the enrolled cohort's.
      .withPeerSubscriber("spanRecorded", {
        eventType: SPAN_RECORDED_EVENT_TYPE,
        data: recordTraceSpanEventDataSchema,
        handle: (data) => deps.source.spanRecorded(data.span),
        options: { enqueue: { filter: (data) => deps.source.mayFold(data.span.tenantId) } },
      })
      .withPeerSubscriber("evaluationCompleted", {
        eventType: EVALUATION_LIFECYCLE_COMPLETED_EVENT_TYPE,
        data: evaluationLifecycleCompletedEventDataSchema,
        handle: (data) => deps.source.evaluationCompleted(data),
        options: { enqueue: { filter: (data) => deps.source.mayFold(data.projectId) } },
      })
      // No enqueue filter: the finished fact's data names no project (only the job's tenant
      // does, which a filter is not shown), so the handler drops runs outside the cohort.
      .withPeerSubscriber("scenarioRunFinished", {
        eventType: SIMULATION_RUN_EVENT_TYPES.FINISHED,
        data: simulationRunFinishedEventDataSchema,
        handle: (data, { tenantId, occurredAt }) =>
          deps.source.scenarioFinished({ data, projectId: tenantId, occurredAt }),
      })
      .withPeerSubscriber("codingAgentSpanFacts", {
        eventType: SPAN_FACTS_CONTRIBUTED_EVENT_TYPE,
        data: spanFactsContributionSchema,
        handle: (data) => deps.source.codingAgentSpan(data),
        options: { enqueue: { filter: (data) => deps.source.mayFold(data.tenantId) } },
      })
      .withPeerSubscriber("codingAgentMetricFacts", {
        eventType: METRIC_FACTS_CONTRIBUTED_EVENT_TYPE,
        data: metricFactsContributionSchema,
        handle: (data) => deps.source.codingAgentMetric(data),
        options: { enqueue: { filter: (data) => deps.source.mayFold(data.tenantId) } },
      })
      // User's erasure fact: digest deletes its own rows naming the person, and sends nothing.
      .withPeerSubscriber("userErased", {
        eventType: USER_ERASED_EVENT_TYPE,
        data: userErasedEventDataSchema,
        handle: ({ userId }) => deps.erasure.forgetUser({ userId }),
      })
      .withCommand("recordProjectActivity", RecordProjectActivityCommand, appendOptions)
      .withCommand("recordUserActivity", RecordUserActivityCommand, appendOptions)
  );
}

export type DigestPipeline = ReturnType<ReturnType<typeof digestActivity>["build"]>;

export function buildDigestPipeline(deps: Parameters<typeof digestActivity>[0]): DigestPipeline {
  return digestActivity(deps).build();
}

export const digestEventing = defineEventingModule({
  pipeline: DIGEST_PIPELINE_NAME,
  build: ({ app }: EventingSetup<DigestRepositories, DigestModule>) => app.pipeline(),
  connect: ({ app, commands }) => app.connectCommands(commands),
});
