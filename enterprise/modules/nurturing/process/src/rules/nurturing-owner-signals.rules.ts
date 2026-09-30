// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import type { NurturingSignal } from "@langwatch/enterprise-nurturing-contract";
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
