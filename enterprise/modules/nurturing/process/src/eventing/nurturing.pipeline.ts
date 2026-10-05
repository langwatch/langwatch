// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import {
  SESSION_STARTED_EVENT_TYPE,
  sessionStartedEventDataSchema,
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
  EVALUATION_LIFECYCLE_COMPLETED_EVENT_TYPE,
  EVALUATION_RAN_EVENT_TYPE,
  type EvaluationLifecycleCompletedEventData,
  evaluationLifecycleCompletedEventDataSchema,
  evaluationRanEventDataSchema,
} from "@langwatch/evaluation-contract";
import {
  defineAggregate,
  defineEventingModule,
  definePipeline,
  type EventingSetup,
  type StaticPipelineDefinition,
} from "@langwatch/eventing";
import {
  EXPERIMENT_RAN_EVENT_TYPE,
  experimentRanEventDataSchema,
} from "@langwatch/experiment-contract";
import {
  GUIDED_ONBOARDING_RECORDED_EVENT_TYPE,
  guidedOnboardingRecordedEventDataSchema,
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
  WORKFLOW_CREATED_EVENT_TYPE,
  workflowCreatedEventDataSchema,
} from "@langwatch/workflow-contract";

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
  promptCreatedSignal,
  scenarioCreatedSignal,
  scenarioRunSucceededSignal,
  sessionStartedSignal,
  signedUpSignal,
  ssoAutoAddedSignal,
  subscriptionChangedSignal,
  subscriptionStartedSignal,
  traceReceivedSignal,
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
  return definePipeline({
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
      handle: (data, { aggregateId }) => {
        const signal = firstTraceRecordedSignal({ data, aggregateId });
        return deps.deliver({ key: nurturingSignalKey(signal), signal });
      },
    })
    .withPeerSubscriber("traceReceived", {
      eventType: TRACE_RECEIVED_EVENT_TYPE,
      data: traceReceivedEventDataSchema,
      handle: (data, { aggregateId }) => {
        const signal = traceReceivedSignal({ data, aggregateId });
        return deps.deliver({ key: nurturingSignalKey(signal), signal });
      },
    })
    .withCommand("recordSignal", RecordNurturingSignalCommand)
    .build();
}

export const nurturingEventing = defineEventingModule({
  pipeline: NURTURING_PIPELINE_NAME,
  build: ({ app }: EventingSetup<never, NurturingModule>) => app.pipeline(),
  connect: ({ app, commands }) => app.connectCommands(commands),
});
