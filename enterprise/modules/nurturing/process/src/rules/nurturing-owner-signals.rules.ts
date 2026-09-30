// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import type {
  CheckoutCompletedEventData,
  SubscriptionChangedEventData,
} from "@langwatch/enterprise-billing-contract";
import type { NurturingSignal } from "@langwatch/enterprise-nurturing-contract";
import type {
  EvaluationLifecycleCompletedEventData,
  EvaluationRanEventData,
} from "@langwatch/evaluation-contract";
import type { ExperimentRanEventData } from "@langwatch/experiment-contract";
import type { GuidedOnboardingRecordedEventData } from "@langwatch/onboarding-contract";

/** The signal a peer's event raises, keyed by the aggregate and instant the event carries. */
type OwnerEvent<Data> = Readonly<{ data: Data; aggregateId: string }>;

/** The picks reach nurturing as `guided_onboarding_paths`, the finished steps as progress. */
export function guidedOnboardingSignal({
  data,
  aggregateId,
}: OwnerEvent<GuidedOnboardingRecordedEventData>): NurturingSignal {
  const source = {
    sourceEventId: `${aggregateId}:${data.event}:${data.occurredAt}`,
    tenantId: data.tenantId,
    occurredAt: data.occurredAt,
    userId: data.userId,
    organizationId: data.organizationId,
  };
  switch (data.event) {
    case "paths_selected":
    case "path_begun":
      return {
        kind: "guided_onboarding_paths",
        ...source,
        event: data.event,
        previousPaths: data.previousPaths,
        paths: data.state.paths,
      };
    case "provider_connected":
    case "tour_completed":
    case "tour_skipped":
    case "path_completed":
      return {
        kind: "guided_onboarding_progress",
        ...source,
        event: data.event,
        payload: data.payload,
        state: data.state,
      };
  }
}

/** Main told Customer.io of a full run of a saved experiment and PostHog of every run. */
export function experimentRanSignal({
  data,
  aggregateId,
}: OwnerEvent<ExperimentRanEventData>): NurturingSignal {
  return {
    kind: "experiment_ran",
    sourceEventId: `${aggregateId}:${data.userId}:${data.occurredAt}`,
    tenantId: data.tenantId,
    occurredAt: data.occurredAt,
    userId: data.userId,
    projectId: data.projectId,
    experimentId: data.experimentId,
    fullRun: data.fullRun,
  };
}

/** A person's hand-run evaluation reaches PostHog alone, as main tracked it. */
export function evaluationRanSignal({
  data,
  aggregateId,
}: OwnerEvent<EvaluationRanEventData>): NurturingSignal {
  return {
    kind: "evaluation_ran",
    sourceEventId: `${aggregateId}:${data.userId}:${data.occurredAt}`,
    tenantId: data.tenantId,
    occurredAt: data.occurredAt,
    userId: data.userId,
    projectId: data.projectId,
  };
}

/** A settled evaluation, against the admin, counted across the organization. */
export function evaluationCompletedSignal({
  data,
  aggregateId,
}: OwnerEvent<EvaluationLifecycleCompletedEventData>): NurturingSignal {
  return {
    kind: "evaluation_completed",
    sourceEventId: `${aggregateId}:${data.evaluationId}`,
    tenantId: data.tenantId,
    occurredAt: data.occurredAt,
    userId: data.userId,
    projectId: data.projectId,
    evaluationId: data.evaluationId,
    evaluatorType: data.evaluatorType,
    score: data.score,
    passed: data.passed,
    organizationEvaluationCount: data.organizationEvaluationCount,
  };
}

/** Every member of the organization carries whether it holds a subscription. */
export function subscriptionChangedSignal({
  data,
  aggregateId,
}: OwnerEvent<SubscriptionChangedEventData>): NurturingSignal {
  return {
    kind: "subscription_changed",
    sourceEventId: `${aggregateId}:subscription:${data.hasSubscription}:${data.occurredAt}`,
    tenantId: data.tenantId,
    occurredAt: data.occurredAt,
    organizationId: data.organizationId,
    memberUserIds: data.memberUserIds,
    hasSubscription: data.hasSubscription,
  };
}

/** A completed checkout reaches PostHog as `subscription_created` and the organization group. */
export function checkoutCompletedSignal({
  data,
  aggregateId,
}: OwnerEvent<CheckoutCompletedEventData>): NurturingSignal {
  return {
    kind: "checkout_completed",
    sourceEventId: `${aggregateId}:${data.subscriptionId}`,
    tenantId: data.tenantId,
    occurredAt: data.occurredAt,
    organizationId: data.organizationId,
    subscriptionId: data.subscriptionId,
    checkoutCreatedAt: data.checkoutCreatedAt,
  };
}
