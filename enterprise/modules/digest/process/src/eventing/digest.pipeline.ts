// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
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
  SUITE_RUN_EVENT_TYPES,
  suiteRunItemCompletedEventDataSchema,
} from "@langwatch/suite-contract";
import { recordTraceSpanEventDataSchema, SPAN_RECORDED_EVENT_TYPE } from "@langwatch/trace-contract";

import type { DigestApp } from "../app/digest.app.ts";
import type { DigestRepositories } from "../repositories/digest.repositories.ts";
import type { ProjectWeekState, UserWeekState } from "../rules/digest-week.rules.ts";
import type { DigestSourceService } from "../services/digest-source.service.ts";
import { RecordProjectActivityCommand, RecordUserActivityCommand } from "./digest-activity.commands.ts";
import {
  DIGEST_ACTIVITY_COALESCE_MAX_BATCH,
  DIGEST_PIPELINE_NAME,
  DIGEST_WEEK_AGGREGATE_TYPE,
  projectActivityRecordedEventSchema,
  userActivityRecordedEventSchema,
} from "./digest-activity.events.ts";
import {
  DIGEST_SEND_INITIAL_STATE,
  DIGEST_SEND_INTERVAL_MS,
  DIGEST_SEND_PROCESS_NAME,
  digestSendIntentSchema,
  digestSendStateSchema,
  digestSendWake,
} from "./digest-send.process.ts";
import { projectWeekProjection, userWeekProjection } from "./digest-week.projection.ts";

export const DIGEST_SEND_PIPELINE_NAME = "digest_send" as const;

/** Outbox rows are bookkeeping, one per wake, pruned after a week. */
const SEND_ROW_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

type Source = Pick<
  DigestSourceService,
  | "spanRecorded"
  | "evaluationCompleted"
  | "scenarioFinished"
  | "suiteItemCompleted"
  | "codingAgentSpan"
  | "codingAgentMetric"
>;

/**
 * The owners' events, folded into weeks. Digest's own subscribers listen on each owner's
 * pipeline (§9) and send its record commands, coalesced so a burst drains as one append.
 */
function digestActivity(deps: {
  projectWeeks: StateProjectionStore<ProjectWeekState>;
  userWeeks: StateProjectionStore<UserWeekState>;
  source: Source;
}) {
  const coalesce = { coalesceMaxBatch: DIGEST_ACTIVITY_COALESCE_MAX_BATCH };
  return definePipeline({
    name: DIGEST_PIPELINE_NAME,
    aggregate: defineAggregate({ type: DIGEST_WEEK_AGGREGATE_TYPE }),
  })
    .withEvents([projectActivityRecordedEventSchema, userActivityRecordedEventSchema])
    .withPostgresProjection(projectWeekProjection({ store: deps.projectWeeks }))
    .withPostgresProjection(userWeekProjection({ store: deps.userWeeks }))
    .withPeerSubscriber("spanRecorded", {
      eventType: SPAN_RECORDED_EVENT_TYPE,
      data: recordTraceSpanEventDataSchema,
      handle: (data) => deps.source.spanRecorded(data.span),
    })
    .withPeerSubscriber("evaluationCompleted", {
      eventType: EVALUATION_LIFECYCLE_COMPLETED_EVENT_TYPE,
      data: evaluationLifecycleCompletedEventDataSchema,
      handle: (data) => deps.source.evaluationCompleted(data),
    })
    .withPeerSubscriber("scenarioRunFinished", {
      eventType: SIMULATION_RUN_EVENT_TYPES.FINISHED,
      data: simulationRunFinishedEventDataSchema,
      handle: (data, { tenantId }) => deps.source.scenarioFinished({ data, projectId: tenantId }),
    })
    .withPeerSubscriber("suiteItemCompleted", {
      eventType: SUITE_RUN_EVENT_TYPES.ITEM_COMPLETED,
      data: suiteRunItemCompletedEventDataSchema,
      handle: (data, { tenantId }) => deps.source.suiteItemCompleted({ data, projectId: tenantId }),
    })
    .withPeerSubscriber("codingAgentSpanFacts", {
      eventType: SPAN_FACTS_CONTRIBUTED_EVENT_TYPE,
      data: spanFactsContributionSchema,
      handle: (data) => deps.source.codingAgentSpan(data),
    })
    .withPeerSubscriber("codingAgentMetricFacts", {
      eventType: METRIC_FACTS_CONTRIBUTED_EVENT_TYPE,
      data: metricFactsContributionSchema,
      handle: (data) => deps.source.codingAgentMetric(data),
    })
    .withCommand("recordProjectActivity", RecordProjectActivityCommand, coalesce)
    .withCommand("recordUserActivity", RecordUserActivityCommand, coalesce);
}

export type DigestPipeline = ReturnType<ReturnType<typeof digestActivity>["build"]>;

export function buildDigestPipeline(deps: Parameters<typeof digestActivity>[0]): DigestPipeline {
  return digestActivity(deps).build();
}

/** The weekly send: a scheduled process manager on a global aggregate, hosted by the worker. */
export function buildDigestSendPipeline({
  app,
  processStore,
}: EventingSetup<unknown, Pick<DigestApp, "sendWeek">>) {
  return definePipeline({
    name: DIGEST_SEND_PIPELINE_NAME,
    aggregate: defineAggregate({ type: "global" }),
  })
    .withEvents([])
    .withProcessManager(DIGEST_SEND_PROCESS_NAME, (pm) =>
      pm
        .state(digestSendStateSchema, DIGEST_SEND_INITIAL_STATE)
        .schedule({ everyMs: DIGEST_SEND_INTERVAL_MS })
        .onWake(digestSendWake)
        .intent("sendWeek", digestSendIntentSchema, async ({ isoWeek }) => {
          const startedAt = Date.now();
          await app.sendWeek({ isoWeek });
          await processStore.deleteDispatchedBefore({
            processName: DIGEST_SEND_PROCESS_NAME,
            before: startedAt - SEND_ROW_RETENTION_MS,
          });
        })
        // A week's sends are claimed per (user, week), so a retried intent mails nobody twice.
        .outbox({ leaseDurationMs: 30 * 60 * 1000, maxAttempts: 3 }),
    )
    .build();
}

export const digestEventing = defineEventingModule({
  pipeline: DIGEST_PIPELINE_NAME,
  build: ({ app }: EventingSetup<DigestRepositories, DigestApp>) => app.pipeline(),
  connect: ({ app, commands }) => app.connectCommands(commands),
});

export const digestSendEventing = defineEventingModule({
  pipeline: DIGEST_SEND_PIPELINE_NAME,
  build: (setup: EventingSetup<DigestRepositories, DigestApp>) => buildDigestSendPipeline(setup),
});
