// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import {
  PULLED_USAGE_AGGREGATE_TYPE,
  PULLED_USAGE_EVENT_TYPES,
  PULLED_USAGE_EVENT_VERSIONS,
  type PulledUsageObservedEvent,
  type PulledUsageObservedEventData,
  type PulledUsageRetractedEvent,
  pulledUsageObservedEventSchema,
  pulledUsageRetractedEventSchema,
} from "@langwatch/enterprise-governance-contract";

import { MemoryGovernanceCostRollupRepository } from "../../repositories/memory/memory.governance-cost-rollup.repository.ts";
import type { GovernanceCostRollupState } from "../../rules/governance-cost-rollup-cell.rules.ts";
import { GovernanceCostRollupFoldProjection } from "../governance-cost-rollup.projection.ts";
import { GovernanceCostRollupStore } from "../governance-cost-rollup.store.ts";

export const TENANT_ID = "tenant-gov-1";
export const DAY_START_MS = Date.UTC(2026, 8, 1, 10);
export const HOUR_MS = 60 * 60 * 1000;

let eventCounter = 0;

function envelope(restatementKey: string) {
  eventCounter += 1;
  return {
    id: `event-${eventCounter}`,
    aggregateId: restatementKey,
    aggregateType: PULLED_USAGE_AGGREGATE_TYPE,
    tenantId: TENANT_ID,
    createdAt: DAY_START_MS,
    occurredAt: DAY_START_MS,
  };
}

export function observed(
  data: Partial<PulledUsageObservedEventData> & { restatementKey: string },
): PulledUsageObservedEvent {
  return pulledUsageObservedEventSchema.parse({
    ...envelope(data.restatementKey),
    type: PULLED_USAGE_EVENT_TYPES.OBSERVED,
    version: PULLED_USAGE_EVENT_VERSIONS.OBSERVED,
    data: {
      itemKey: data.restatementKey,
      source: "openai",
      ingestionSourceId: "source-1",
      organizationId: "org-1",
      teamId: null,
      projectId: null,
      model: "gpt-5-mini",
      tokensInput: 10,
      tokensOutput: 5,
      tokensCacheRead: 0,
      tokensCacheWrite: 0,
      costNanoMinor: 1_000,
      currencyCode: "USD",
      costNanoUsd: null,
      rateVersion: null,
      costBasis: "provider_reported",
      costStatus: "exact",
      occurredAtMs: DAY_START_MS,
      observedAtMs: DAY_START_MS + HOUR_MS,
      ...data,
    },
  });
}

export function retracted({
  restatementKey,
  observedAtMs,
  rawActorId = "",
}: {
  restatementKey: string;
  observedAtMs: number;
  rawActorId?: string;
}): PulledUsageRetractedEvent {
  return pulledUsageRetractedEventSchema.parse({
    ...envelope(restatementKey),
    type: PULLED_USAGE_EVENT_TYPES.RETRACTED,
    version: PULLED_USAGE_EVENT_VERSIONS.RETRACTED,
    data: {
      restatementKey,
      source: "openai",
      ingestionSourceId: "source-1",
      organizationId: "org-1",
      model: "gpt-5-mini",
      costNanoMinor: 0,
      currencyCode: "USD",
      costNanoUsd: null,
      rawActorId,
      agentId: "",
      occurredAtMs: DAY_START_MS,
      observedAtMs,
    },
  });
}

export function rollupFold({
  pseudonyms = new Map<string, string>(),
}: { pseudonyms?: Map<string, string> } = {}) {
  const repository = MemoryGovernanceCostRollupRepository.create();
  const projection = GovernanceCostRollupFoldProjection.create({
    store: GovernanceCostRollupStore.create(repository),
    actorIds: {
      actorIdForRollupWrite: ({ rawActorId }) => pseudonyms.get(rawActorId) ?? rawActorId,
    },
  });
  const fold = (events: readonly (PulledUsageObservedEvent | PulledUsageRetractedEvent)[]) =>
    events.reduce<GovernanceCostRollupState>(
      (state, event) => projection.apply(state, event),
      projection.init(),
    );
  return { repository, projection, fold };
}
