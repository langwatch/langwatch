// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import {
  CHECKOUT_COMPLETED_EVENT_TYPE,
  checkoutCompletedEventDataSchema,
  SUBSCRIPTION_CHANGED_EVENT_TYPE,
  subscriptionChangedEventDataSchema,
} from "@langwatch/enterprise-billing-contract";
import type { NurturingSignal } from "@langwatch/enterprise-nurturing-contract";
import {
  EVALUATION_LIFECYCLE_COMPLETED_EVENT_TYPE,
  EVALUATION_RAN_EVENT_TYPE,
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

import type { NurturingApp } from "../app/nurturing.app.ts";
import {
  checkoutCompletedSignal,
  evaluationCompletedSignal,
  evaluationRanSignal,
  experimentRanSignal,
  guidedOnboardingSignal,
  subscriptionChangedSignal,
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
 * Owners' commands land here as events; the worker's subscriber sends each one out. Owners that
 * record their own lifecycle events are reacted to here as peers (§9), delivered without a hop.
 */
export function buildNurturingPipeline(deps: {
  deliver: (input: { key: string; signal: NurturingSignal }) => Promise<void>;
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
      handle: (data, { aggregateId }) => {
        const signal = evaluationCompletedSignal({ data, aggregateId });
        return deps.deliver({ key: nurturingSignalKey(signal), signal });
      },
    })
    .withPeerSubscriber("subscriptionChanged", {
      eventType: SUBSCRIPTION_CHANGED_EVENT_TYPE,
      data: subscriptionChangedEventDataSchema,
      handle: (data, { aggregateId }) => {
        const signal = subscriptionChangedSignal({ data, aggregateId });
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
    .withCommand("recordSignal", RecordNurturingSignalCommand)
    .build();
}

export const nurturingEventing = defineEventingModule({
  pipeline: NURTURING_PIPELINE_NAME,
  build: ({ app }: EventingSetup<never, NurturingApp>) => app.pipeline(),
  connect: ({ app, commands }) => app.connectCommands(commands),
});
