// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import type { CioBatchCall, NurturingSignalOf } from "@langwatch/enterprise-nurturing-contract";
import type {
  ScenarioRunGraceEndedEventData,
  ScenarioRunsThresholdReachedEventData,
} from "@langwatch/entitlement-contract";
import { Temporal } from "@langwatch/time";

import type { PostHogEventInput } from "../channels/posthog.channel.ts";

type ScenarioRunCapKind = "scenario_runs_threshold_reached" | "scenario_run_grace_ended";
type ScenarioRunCapSignal = NurturingSignalOf<ScenarioRunCapKind>;
type Source = Readonly<{ aggregateId: string; tenantId: string; memberUserIds: string[] }>;

/** Entitlement's threshold fact as the signal every member of the organization is told. */
export function scenarioRunsThresholdSignal({
  data,
  aggregateId,
  tenantId,
  memberUserIds,
}: Source & {
  data: ScenarioRunsThresholdReachedEventData;
}): NurturingSignalOf<"scenario_runs_threshold_reached"> {
  return {
    kind: "scenario_runs_threshold_reached",
    sourceEventId: `${aggregateId}:scenario_runs_threshold:${data.month}`,
    tenantId,
    occurredAt: data.occurredAt,
    organizationId: data.organizationId,
    memberUserIds,
    runs: data.runs,
    limit: data.maxPerMonth,
    month: data.month,
  };
}

/** Entitlement's grace-ended fact as the signal every member of the organization is told. */
export function scenarioRunGraceEndedSignal({
  data,
  aggregateId,
  tenantId,
  memberUserIds,
}: Source & {
  data: ScenarioRunGraceEndedEventData;
}): NurturingSignalOf<"scenario_run_grace_ended"> {
  return {
    kind: "scenario_run_grace_ended",
    sourceEventId: `${aggregateId}:scenario_run_grace_ended`,
    tenantId,
    occurredAt: data.occurredAt,
    organizationId: data.organizationId,
    memberUserIds,
    graceEndedAt: data.graceEndedAt,
    runLimit: data.maxPerMonth,
  };
}

function propertiesOf(signal: ScenarioRunCapSignal): Record<string, unknown> {
  if (signal.kind === "scenario_runs_threshold_reached") {
    const { organizationId, runs, limit, month } = signal;
    return { organizationId, runs, limit, month };
  }
  const { organizationId, graceEndedAt, runLimit } = signal;
  return {
    organizationId,
    graceEndedAt: Temporal.Instant.fromEpochMilliseconds(graceEndedAt).toString(),
    runLimit,
  };
}

/** One Customer.io track per member; the source id keeps a replay from sending twice. */
export function fireScenarioRunCapCustomerIo(signal: ScenarioRunCapSignal): CioBatchCall[] {
  const properties = propertiesOf(signal);
  return signal.memberUserIds.map((userId) => ({
    type: "track",
    userId,
    event: signal.kind,
    properties,
    messageId: `${signal.sourceEventId}:${userId}`,
  }));
}

/** One PostHog event per member, grouped under the organization. */
export function fireScenarioRunCapPostHog(signal: ScenarioRunCapSignal): PostHogEventInput[] {
  const properties = {
    ...propertiesOf(signal),
    $groups: { organization: signal.organizationId },
  };
  return signal.memberUserIds.map((userId) => ({ userId, event: signal.kind, properties }));
}
