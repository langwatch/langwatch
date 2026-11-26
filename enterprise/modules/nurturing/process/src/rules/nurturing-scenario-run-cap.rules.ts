// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import type {
  CioBatchCall,
  NurturingSignal,
  NurturingSignalOf,
} from "@langwatch/enterprise-nurturing-contract";
import type {
  ScenarioRunGraceEndedEventData,
  ScenarioRunsThresholdReachedEventData,
} from "@langwatch/entitlement-contract";
import { Temporal } from "@langwatch/time";

import type { PostHogEventInput } from "../channels/posthog.channel.ts";
import { fireCodingOrApp, isCodingOrAppSignal } from "./nurturing-coding-delivery.rules.ts";
import { postHogUuidFor } from "./nurturing-guided-onboarding-service.rules.ts";

type ScenarioRunCapKind = "scenario_runs_threshold_reached" | "scenario_run_grace_ended";
type ScenarioRunCapSignal = NurturingSignalOf<ScenarioRunCapKind>;
const SCENARIO_RUN_CAP_KINDS: readonly string[] = [
  "scenario_runs_threshold_reached",
  "scenario_run_grace_ended",
] satisfies ScenarioRunCapKind[];
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

/** One PostHog event per member, grouped under the organization; a redelivery keeps its uuid. */
export function fireScenarioRunCapPostHog(signal: ScenarioRunCapSignal): PostHogEventInput[] {
  const properties = {
    ...propertiesOf(signal),
    $groups: { organization: signal.organizationId },
  };
  const timestamp = Temporal.Instant.fromEpochMilliseconds(signal.occurredAt);
  return signal.memberUserIds.map((userId) => ({
    userId,
    event: signal.kind,
    properties,
    uuid: postHogUuidFor(`${signal.sourceEventId}:${userId}`),
    timestamp,
  }));
}

function isScenarioRunCapSignal(signal: NurturingSignal): signal is ScenarioRunCapSignal {
  return SCENARIO_RUN_CAP_KINDS.includes(signal.kind);
}

/** How a signal reaches Customer.io: as calls that need no claim or read, or routed by its kind. */
export type CustomerIoRoute = { kind: "direct"; calls: CioBatchCall[] } | { kind: "routed" };

/** Coding, app and run cap facts go straight out; every other signal is routed by its kind. */
export function customerIoRouteOf(signal: NurturingSignal): CustomerIoRoute {
  if (isCodingOrAppSignal(signal)) return { kind: "direct", calls: fireCodingOrApp(signal) };
  if (isScenarioRunCapSignal(signal)) {
    return { kind: "direct", calls: fireScenarioRunCapCustomerIo(signal) };
  }
  return { kind: "routed" };
}
