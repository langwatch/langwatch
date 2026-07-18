import type { AppendStore } from "../../../projections/mapProjection.types";
import type { MapProjectionDefinition } from "../../../projections/mapProjection.types";
import { TRIGGER_MATCH_RECORDED_EVENT_TYPE } from "../schemas/constants";
import type { AutomationEvent } from "../schemas/events";

export interface AutomationAuditRecord {
  eventId: string;
  triggerId: string;
  traceId: string;
  actionClass: "notify" | "persist";
  occurredAtMs: number;
}

export function createAutomationAuditMapProjection({
  store,
}: {
  store: AppendStore<AutomationAuditRecord>;
}): MapProjectionDefinition<AutomationAuditRecord, AutomationEvent> {
  return {
    name: "automationAudit",
    eventTypes: [TRIGGER_MATCH_RECORDED_EVENT_TYPE],
    map: (event) => ({
      eventId: event.id,
      triggerId: event.data.triggerId,
      traceId: event.data.traceId,
      actionClass: event.data.actionClass,
      occurredAtMs: event.occurredAt,
    }),
    store,
    options: { dedupeByIdempotencyKey: true },
  };
}
