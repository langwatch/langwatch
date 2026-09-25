// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import type { GovernanceIngestionSource } from "@langwatch/enterprise-governance-contract";
import { fromDate } from "@langwatch/time";

import type { IngestionPullLifecycleSource } from "../repositories/ingestion-pull-lifecycle.repository.ts";

export interface SchedulableSourceRecord {
  status: string;
  pullSchedule: string | null;
  archivedAt: object | null;
}

/** Whether the scheduler configures a pull for this source; the one rule both it and the sync control read. */
export function schedulerWillPull(source: SchedulableSourceRecord): boolean {
  return (
    source.pullSchedule !== null &&
    source.archivedAt === null &&
    (source.status === "active" || source.status === "awaiting_first_event")
  );
}

/** A stored source as the pull lifecycle reads it: its moments as instants. */
export function toPullLifecycleSource(
  source: GovernanceIngestionSource,
): IngestionPullLifecycleSource {
  return {
    id: source.id,
    organizationId: source.organizationId,
    status: source.status,
    pullSchedule: source.pullSchedule,
    pollerCursor: source.pollerCursor,
    updatedAt: fromDate(source.updatedAt),
    archivedAt: source.archivedAt ? fromDate(source.archivedAt) : null,
  };
}
