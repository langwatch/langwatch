// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import {
  SESSION_STARTED_EVENT_TYPE,
  sessionStartedEventDataSchema,
  SIGNED_UP_EVENT_TYPE,
  signedUpEventDataSchema,
  SSO_AUTO_ADDED_EVENT_TYPE,
  ssoAutoAddedEventDataSchema,
} from "@langwatch/auth-contract";
import {
  CHECKOUT_COMPLETED_EVENT_TYPE,
  checkoutCompletedEventDataSchema,
  SUBSCRIPTION_CHANGED_EVENT_TYPE,
  subscriptionChangedEventDataSchema,
  SUBSCRIPTION_STARTED_EVENT_TYPE,
  subscriptionStartedEventDataSchema,
} from "@langwatch/enterprise-billing-contract";
import type { NurturingSignal } from "@langwatch/enterprise-nurturing-contract";
import {
  USAGE_REPORT_RECEIVED_EVENT_TYPE,
  type UsageReportReceivedEventData,
  usageReportReceivedEventDataSchema,
} from "@langwatch/enterprise-saas-contract";
import {
  EVALUATION_COMPLETED_EVENT_TYPE,
  EVALUATION_LIFECYCLE_AGGREGATE_TYPE,
  EVALUATION_LIFECYCLE_COMPLETED_EVENT_TYPE,
  EVALUATION_RAN_EVENT_TYPE,
  EVALUATION_REPORTED_EVENT_TYPE,
  type EvaluationLifecycleCompletedEventData,
  evaluationLifecycleCompletedEventDataSchema,
  evaluationRanEventDataSchema,
  evaluationRunDataSchema,
} from "@langwatch/evaluation-contract";
import {
  defineAggregate,
  defineEventingModule,
  definePipeline,
  type EventingSetup,
  type LaneAlias,
  type StaticPipelineDefinition,
} from "@langwatch/eventing";
import {
  EXPERIMENT_RAN_EVENT_TYPE,
  experimentRanEventDataSchema,
} from "@langwatch/experiment-contract";
import {
  GUIDED_ONBOARDING_TURN_FAILED_EVENT_TYPE,
  type GuidedOnboardingTurnFailedEventData,
  guidedOnboardingTurnFailedEventDataSchema,
} from "@langwatch/langy-contract";
import {
  GUIDED_ONBOARDING_RECORDED_EVENT_TYPE,
  guidedOnboardingRecordedEventDataSchema,
  ONBOARDING_VARIANT_ASSIGNED_EVENT_TYPE,
  onboardingVariantAssignedEventDataSchema,
  onboardingVariantSchema,
} from "@langwatch/onboarding-contract";
import {
  INTEGRATION_METHOD_CHOSEN_EVENT_TYPE,
  integrationMethodChosenEventDataSchema,
  INVITE_ACCEPTED_EVENT_TYPE,
  inviteAcceptedEventDataSchema,
  MEMBERS_INVITED_EVENT_TYPE,
  membersInvitedEventDataSchema,
  ORGANIZATION_SIGNED_UP_EVENT_TYPE,
  organizationSignedUpEventDataSchema,
} from "@langwatch/organization-contract";
import {
  PROJECT_CREATED_EVENT_TYPE,
  type ProjectCreatedEventData,
  projectCreatedEventDataSchema,
} from "@langwatch/project-contract";
import {
  PROMPT_CREATED_EVENT_TYPE,
  promptCreatedEventDataSchema,
} from "@langwatch/prompt-contract";
import {
  SCENARIO_CREATED_EVENT_TYPE,
  scenarioCreatedEventDataSchema,
  SIMULATION_RUN_EVENT_TYPES,
  type SimulationRunFinishedEventData,
  simulationRunFinishedEventDataSchema,
} from "@langwatch/scenario-contract";
import {
  FIRST_TRACE_RECORDED_EVENT_TYPE,
  firstTraceRecordedEventDataSchema,
  TRACE_RECEIVED_EVENT_TYPE,
  traceReceivedEventDataSchema,
} from "@langwatch/trace-contract";
import {
  USER_CREATED_EVENT_TYPE,
  USER_REGISTERED_EVENT_TYPE,
  userCreatedEventDataSchema,
  userLifecycleEventDataSchema,
} from "@langwatch/user-contract";
import {
  WORKFLOW_CREATED_EVENT_TYPE,
  workflowCreatedEventDataSchema,
} from "@langwatch/workflow-contract";
import { z } from "zod";

import type { NurturingModule } from "../app/nurturing.app.ts";
import {
  checkoutCompletedSignal,
  evaluationRanSignal,
  experimentRanSignal,
  firstTraceRecordedSignal,
  guidedOnboardingSignal,
  integrationMethodChosenSignal,
  inviteAcceptedSignal,
  membersInvitedSignal,
  onboardingVariantAssignedSignal,
  projectActiveDaySignal,
  promptCreatedSignal,
  scenarioCreatedSignal,
  scenarioRunActiveDaySignal,
  scenarioRunSucceededSignal,
  sessionStartedSignal,
  signedUpSignal,
  ssoAutoAddedSignal,
  subscriptionChangedSignal,
  subscriptionStartedSignal,
  traceReceivedSignal,
  userCreatedSignal,
  userRegisteredSignal,
  workflowCreatedSignal,
} from "../rules/nurturing-owner-signals.rules.ts";
import { nurturingSignalKey, RecordNurturingSignalCommand } from "./nurturing-signal.commands.ts";
import {
  NURTURING_PIPELINE_NAME,
  NURTURING_SIGNAL_AGGREGATE_TYPE,
  NURTURING_SIGNAL_RECORDED_EVENT_TYPE,
  type NurturingSignalRecordedEvent,
  nurturingSignalRecordedEventSchema,
  type RecordNurturingSignalCommandData,
} from "./nurturing-signal.events.ts";

/** Main's Customer.io evaluation job: the settled evaluation's event and its run's fold state. */
const mainEvaluationSyncJobSchema = z.object({
  event: z.record(z.string(), z.unknown()),
  foldState: evaluationRunDataSchema.pick({
    evaluationId: true,
    evaluatorType: true,
    score: true,
    passed: true,
  }),
});
const mainEvaluationEventSchema = z.object({
  tenantId: z.string().min(1),
  occurredAt: z.number().int().nonnegative(),
});

/** Main's job as the settled-evaluation fact evaluation records now, keyed by its project. */
export function mainEvaluationSyncAsLifecycleCompleted(stored: unknown): Record<string, unknown> {
  const { event, foldState } = mainEvaluationSyncJobSchema.parse(stored);
  const { tenantId, occurredAt } = mainEvaluationEventSchema.parse(event);
  const data: EvaluationLifecycleCompletedEventData = {
    tenantId,
    occurredAt,
    projectId: tenantId,
    ...foldState,
  };
  return {
    ...event,
    aggregateType: EVALUATION_LIFECYCLE_AGGREGATE_TYPE,
    aggregateId: tenantId,
    type: EVALUATION_LIFECYCLE_COMPLETED_EVENT_TYPE,
    data,
  };
}

/**
 * Main's lanes whose work is nurturing's now, for one release. Main's Customer.io syncs (SaaS only)
 * reach the lanes that count the same milestones, each claimed before it is counted; trace's sync
 * is tombstoned, as trace's `projectMetadata` job, queued beside it, records its facts.
 */
export const MAIN_NURTURING_LANE_ALIASES: readonly LaneAlias[] = [
  {
    from: "simulation_processing:subscriber:scenarioRunMilestones",
    to: { jobType: "subscriber", lane: "scenarioRunSucceeded" },
  },
  {
    from: "simulation_processing:reactor:customerIoSimulationSync",
    to: { jobType: "subscriber", lane: "simulationRunFinished" },
    eventTypes: [SIMULATION_RUN_EVENT_TYPES.FINISHED],
  },
  {
    from: "evaluation_processing:reactor:customerIoEvaluationSync",
    to: { jobType: "subscriber", lane: "evaluationCompleted" },
    eventTypes: [EVALUATION_COMPLETED_EVENT_TYPE, EVALUATION_REPORTED_EVENT_TYPE],
    data: mainEvaluationSyncAsLifecycleCompleted,
  },
  {
    from: "trace_processing:reactor:customerIoTraceSync",
    tombstone:
      "trace's projectMetadata job, queued beside it, records the first-trace and trace-received facts nurturing sends",
  },
];

export type NurturingPipeline = StaticPipelineDefinition<
  NurturingSignalRecordedEvent,
  Record<string, never>,
  { name: "recordSignal"; payload: RecordNurturingSignalCommandData }
>;

/**
 * Owners record their own lifecycle events and nurturing reacts to them here as peers (§9),
 * delivered without a hop; a recorded signal command is sent out by the worker's subscriber.
 */
export function buildNurturingPipeline(deps: {
  deliver: (input: { key: string; signal: NurturingSignal }) => Promise<void>;
  projectCreated: (data: ProjectCreatedEventData) => Promise<void>;
  guidedTurnFailed: (data: GuidedOnboardingTurnFailedEventData) => Promise<void>;
  usageReportReceived: (input: {
    data: UsageReportReceivedEventData;
    eventId: string;
  }) => Promise<void>;
  evaluationCompleted: (input: {
    data: EvaluationLifecycleCompletedEventData;
    aggregateId: string;
  }) => Promise<NurturingSignal[]>;
  simulationRunFinished: (input: {
    data: SimulationRunFinishedEventData;
    aggregateId: string;
    tenantId: string;
  }) => Promise<NurturingSignal[]>;
}): NurturingPipeline {
  /** The project's first application signal of the UTC day; delivery's claim drops the rest. */
  const deliverActiveDay = ({
    onboardingVariant,
    ...input
  }: Omit<Parameters<typeof projectActiveDaySignal>[0], "onboardingVariant"> & {
    onboardingVariant?: string | null;
  }) => {
    const parsed = onboardingVariantSchema.safeParse(onboardingVariant);
    const signal = projectActiveDaySignal({
      ...input,
      onboardingVariant: parsed.success ? parsed.data : null,
    });
    return deps.deliver({ key: nurturingSignalKey(signal), signal });
  };
  return (
    definePipeline({
      name: NURTURING_PIPELINE_NAME,
      aggregate: defineAggregate({ type: NURTURING_SIGNAL_AGGREGATE_TYPE }),
    })
      .withEvents([nurturingSignalRecordedEventSchema])
      .withEventSubscriber("deliverSignal", {
        events: [NURTURING_SIGNAL_RECORDED_EVENT_TYPE],
        handler: (event: NurturingSignalRecordedEvent) =>
          deps.deliver({ key: event.aggregateId, signal: event.data.signal }),
      })
      .withPeerSubscriber("guidedOnboardingRecorded", {
        eventType: GUIDED_ONBOARDING_RECORDED_EVENT_TYPE,
        data: guidedOnboardingRecordedEventDataSchema,
        handle: (data, { aggregateId }) => {
          const signal = guidedOnboardingSignal({ data, aggregateId });
          return deps.deliver({ key: nurturingSignalKey(signal), signal });
        },
      })
      .withPeerSubscriber("onboardingVariantAssigned", {
        eventType: ONBOARDING_VARIANT_ASSIGNED_EVENT_TYPE,
        data: onboardingVariantAssignedEventDataSchema,
        handle: (data, { aggregateId }) => {
          const signal = onboardingVariantAssignedSignal({ data, aggregateId });
          return deps.deliver({ key: nurturingSignalKey(signal), signal });
        },
      })
      .withPeerSubscriber("guidedOnboardingTurnFailed", {
        eventType: GUIDED_ONBOARDING_TURN_FAILED_EVENT_TYPE,
        data: guidedOnboardingTurnFailedEventDataSchema,
        handle: (data) => deps.guidedTurnFailed(data),
      })
      .withPeerSubscriber("usageReportReceived", {
        eventType: USAGE_REPORT_RECEIVED_EVENT_TYPE,
        data: usageReportReceivedEventDataSchema,
        handle: (data, { eventId }) => deps.usageReportReceived({ data, eventId }),
      })
      .withPeerSubscriber("experimentRan", {
        eventType: EXPERIMENT_RAN_EVENT_TYPE,
        data: experimentRanEventDataSchema,
        handle: (data, { aggregateId }) => {
          const signal = experimentRanSignal({ data, aggregateId });
          return deps.deliver({ key: nurturingSignalKey(signal), signal });
        },
      })
      .withPeerSubscriber("evaluationRan", {
        eventType: EVALUATION_RAN_EVENT_TYPE,
        data: evaluationRanEventDataSchema,
        handle: (data, { aggregateId }) => {
          const signal = evaluationRanSignal({ data, aggregateId });
          return deps.deliver({ key: nurturingSignalKey(signal), signal });
        },
      })
      .withPeerSubscriber("evaluationCompleted", {
        eventType: EVALUATION_LIFECYCLE_COMPLETED_EVENT_TYPE,
        data: evaluationLifecycleCompletedEventDataSchema,
        handle: async (data, { aggregateId }) => {
          for (const signal of await deps.evaluationCompleted({ data, aggregateId })) {
            await deps.deliver({ key: nurturingSignalKey(signal), signal });
          }
        },
      })
      .withPeerSubscriber("projectCreated", {
        eventType: PROJECT_CREATED_EVENT_TYPE,
        data: projectCreatedEventDataSchema,
        handle: (data) => deps.projectCreated(data),
      })
      .withPeerSubscriber("subscriptionChanged", {
        eventType: SUBSCRIPTION_CHANGED_EVENT_TYPE,
        data: subscriptionChangedEventDataSchema,
        handle: (data, { aggregateId }) => {
          const signal = subscriptionChangedSignal({ data, aggregateId });
          return deps.deliver({ key: nurturingSignalKey(signal), signal });
        },
      })
      .withPeerSubscriber("subscriptionStarted", {
        eventType: SUBSCRIPTION_STARTED_EVENT_TYPE,
        data: subscriptionStartedEventDataSchema,
        handle: (data, { aggregateId }) => {
          const signal = subscriptionStartedSignal({ data, aggregateId });
          return deps.deliver({ key: nurturingSignalKey(signal), signal });
        },
      })
      .withPeerSubscriber("checkoutCompleted", {
        eventType: CHECKOUT_COMPLETED_EVENT_TYPE,
        data: checkoutCompletedEventDataSchema,
        handle: (data, { aggregateId }) => {
          const signal = checkoutCompletedSignal({ data, aggregateId });
          return deps.deliver({ key: nurturingSignalKey(signal), signal });
        },
      })
      .withPeerSubscriber("sessionStarted", {
        eventType: SESSION_STARTED_EVENT_TYPE,
        data: sessionStartedEventDataSchema,
        handle: (data, { aggregateId }) => {
          const signal = sessionStartedSignal({ data, aggregateId });
          return deps.deliver({ key: nurturingSignalKey(signal), signal });
        },
      })
      .withPeerSubscriber("ssoAutoAdded", {
        eventType: SSO_AUTO_ADDED_EVENT_TYPE,
        data: ssoAutoAddedEventDataSchema,
        handle: (data, { aggregateId }) => {
          const signal = ssoAutoAddedSignal({ data, aggregateId });
          return deps.deliver({ key: nurturingSignalKey(signal), signal });
        },
      })
      .withPeerSubscriber("organizationSignedUp", {
        eventType: ORGANIZATION_SIGNED_UP_EVENT_TYPE,
        data: organizationSignedUpEventDataSchema,
        handle: (data, { aggregateId }) => {
          const signal = signedUpSignal({ data, aggregateId });
          return deps.deliver({ key: nurturingSignalKey(signal), signal });
        },
      })
      .withPeerSubscriber("userRegistered", {
        eventType: USER_REGISTERED_EVENT_TYPE,
        data: userLifecycleEventDataSchema,
        handle: (data) => {
          const signal = userRegisteredSignal({ data });
          return deps.deliver({ key: nurturingSignalKey(signal), signal });
        },
      })
      // Identify only (round 35): a seeded fact names an account older than the fact, never sent.
      .withPeerSubscriber("userCreated", {
        eventType: USER_CREATED_EVENT_TYPE,
        data: userCreatedEventDataSchema,
        handle: async (data) => {
          if (data.backfilled) return;
          const signal = userCreatedSignal({ data });
          await deps.deliver({ key: nurturingSignalKey(signal), signal });
        },
      })
      .withPeerSubscriber("authSignedUp", {
        eventType: SIGNED_UP_EVENT_TYPE,
        data: signedUpEventDataSchema,
        handle: (data) => {
          const signal = userRegisteredSignal({ data });
          return deps.deliver({ key: nurturingSignalKey(signal), signal });
        },
      })
      .withPeerSubscriber("membersInvited", {
        eventType: MEMBERS_INVITED_EVENT_TYPE,
        data: membersInvitedEventDataSchema,
        handle: (data, { aggregateId }) => {
          const signal = membersInvitedSignal({ data, aggregateId });
          return deps.deliver({ key: nurturingSignalKey(signal), signal });
        },
      })
      .withPeerSubscriber("inviteAccepted", {
        eventType: INVITE_ACCEPTED_EVENT_TYPE,
        data: inviteAcceptedEventDataSchema,
        handle: (data, { aggregateId }) => {
          const signal = inviteAcceptedSignal({ data, aggregateId });
          return deps.deliver({ key: nurturingSignalKey(signal), signal });
        },
      })
      .withPeerSubscriber("integrationMethodChosen", {
        eventType: INTEGRATION_METHOD_CHOSEN_EVENT_TYPE,
        data: integrationMethodChosenEventDataSchema,
        handle: (data, { aggregateId }) => {
          const signal = integrationMethodChosenSignal({ data, aggregateId });
          return deps.deliver({ key: nurturingSignalKey(signal), signal });
        },
      })
      .withPeerSubscriber("promptCreated", {
        eventType: PROMPT_CREATED_EVENT_TYPE,
        data: promptCreatedEventDataSchema,
        handle: (data, context) => {
          const signal = promptCreatedSignal({ data, ...context });
          return deps.deliver({ key: nurturingSignalKey(signal), signal });
        },
      })
      .withPeerSubscriber("workflowCreated", {
        eventType: WORKFLOW_CREATED_EVENT_TYPE,
        data: workflowCreatedEventDataSchema,
        handle: (data, context) => {
          const signal = workflowCreatedSignal({ data, ...context });
          return deps.deliver({ key: nurturingSignalKey(signal), signal });
        },
      })
      .withPeerSubscriber("scenarioCreated", {
        eventType: SCENARIO_CREATED_EVENT_TYPE,
        data: scenarioCreatedEventDataSchema,
        handle: (data, context) => {
          const signal = scenarioCreatedSignal({ data, ...context });
          return deps.deliver({ key: nurturingSignalKey(signal), signal });
        },
      })
      .withPeerSubscriber("scenarioRunSucceeded", {
        eventType: SIMULATION_RUN_EVENT_TYPES.FINISHED,
        data: simulationRunFinishedEventDataSchema,
        handle: async (data, context) => {
          for (const signal of scenarioRunSucceededSignal({ data, ...context })) {
            await deps.deliver({ key: nurturingSignalKey(signal), signal });
          }
          for (const signal of scenarioRunActiveDaySignal({ data, ...context })) {
            await deps.deliver({ key: nurturingSignalKey(signal), signal });
          }
        },
      })
      .withPeerSubscriber("simulationRunFinished", {
        eventType: SIMULATION_RUN_EVENT_TYPES.FINISHED,
        data: simulationRunFinishedEventDataSchema,
        handle: async (data, context) => {
          for (const signal of await deps.simulationRunFinished({ data, ...context })) {
            await deps.deliver({ key: nurturingSignalKey(signal), signal });
          }
        },
      })
      .withPeerSubscriber("firstTraceRecorded", {
        eventType: FIRST_TRACE_RECORDED_EVENT_TYPE,
        data: firstTraceRecordedEventDataSchema,
        handle: async (data, { aggregateId }) => {
          const signal = firstTraceRecordedSignal({ data, aggregateId });
          await deps.deliver({ key: nurturingSignalKey(signal), signal });
          await deliverActiveDay({ source: "trace", ...data });
        },
      })
      .withPeerSubscriber("traceReceived", {
        eventType: TRACE_RECEIVED_EVENT_TYPE,
        data: traceReceivedEventDataSchema,
        handle: async (data, { aggregateId }) => {
          const signal = traceReceivedSignal({ data, aggregateId });
          await deps.deliver({ key: nurturingSignalKey(signal), signal });
          await deliverActiveDay({ source: "trace", ...data });
        },
      })
      .withCommand("recordSignal", RecordNurturingSignalCommand)
      .withLaneAliases(MAIN_NURTURING_LANE_ALIASES)
      .build()
  );
}

export const nurturingEventing = defineEventingModule({
  pipeline: NURTURING_PIPELINE_NAME,
  build: ({ app }: EventingSetup<never, NurturingModule>) => app.pipeline(),
  connect: ({ app, commands }) => app.connectCommands(commands),
});
