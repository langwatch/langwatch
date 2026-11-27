// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import type { OcsfIngestEvent } from "@langwatch/enterprise-governance-contract";
import { Temporal } from "@langwatch/time";

import type { GovernanceOcsfEvent } from "../../../repositories/governance.repositories.ts";

function text(value: unknown): string {
  return typeof value === "string" ? value.slice(0, 512) : "";
}

/**
 * One OCSF event from another source as a governance_ocsf_events row. The row's identity is
 * (sourceType, sourceId, metadata.uid), so a redelivered event replaces itself at merge time.
 */
export function ocsfEventToGovernanceRow({
  tenantId,
  sourceType,
  sourceId,
  event,
  targetName,
}: {
  tenantId: string;
  sourceType: string;
  sourceId: string;
  event: OcsfIngestEvent;
  targetName?: string;
}): GovernanceOcsfEvent {
  const actor = (event.actor ?? {}) as { user?: { uid?: unknown; email_addr?: unknown } };
  const api = (event.api ?? {}) as { operation?: unknown };
  const target = (event.dst_endpoint ?? {}) as { name?: unknown; hostname?: unknown };
  const activityId = event.activity_id ?? 0;
  return {
    tenantId,
    eventId: `${sourceType}:${sourceId}:${event.metadata.uid}`,
    classUid: event.class_uid,
    categoryUid: event.category_uid ?? Math.floor(event.class_uid / 1000),
    typeUid: event.type_uid ?? event.class_uid * 100 + activityId,
    traceId: "",
    sourceId,
    sourceType,
    activityId,
    severityId: event.severity_id,
    eventTime: Temporal.Instant.fromEpochMilliseconds(event.time),
    actorUserId: text(actor.user?.uid),
    actorEmail: text(actor.user?.email_addr),
    actorEnduserId: "",
    actionName: text(api.operation) || text(event.class_name) || `class_${event.class_uid}`,
    targetName: text(targetName) || text(target.name) || text(target.hostname),
    anomalyAlertId: "",
    rawOcsfJson: JSON.stringify(event),
  };
}
