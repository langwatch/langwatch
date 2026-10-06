import type { Command, CommandHandler } from "@langwatch/eventing";
import { createTenantId, defineCommandSchema, EventSchema, EventUtils } from "@langwatch/eventing";
import {
  ORGANIZATION_AUDIT_RECORDED_EVENT_TYPE,
  ORGANIZATION_AUDIT_RECORDED_EVENT_VERSION,
  organizationAuditRecordedEventDataSchema,
} from "@langwatch/organization-contract";
import { z } from "zod";

import { ORGANIZATION_AGGREGATE_TYPE } from "./organization-lifecycle.events.ts";

/** Organization's audit facts; audit-log writes its rows from its own side (Alex, 2026-10-06). */
export const ORGANIZATION_AUDIT_PIPELINE_NAME = "organization_audit" as const;

export const RECORD_AUDIT_COMMAND_TYPE = "lw.organization.record_audit" as const;

export const recordAuditCommandDataSchema = organizationAuditRecordedEventDataSchema;
export type RecordAuditCommandData = z.infer<typeof recordAuditCommandDataSchema>;

export const organizationAuditRecordedEventSchema = z.object({
  ...EventSchema.shape,
  type: z.literal(ORGANIZATION_AUDIT_RECORDED_EVENT_TYPE),
  version: z.literal(ORGANIZATION_AUDIT_RECORDED_EVENT_VERSION),
  data: organizationAuditRecordedEventDataSchema,
});
type OrganizationAuditRecordedEvent = z.infer<typeof organizationAuditRecordedEventSchema>;

/** Records one audited change, keyed by the audit id its commit minted. */
export class RecordAuditCommand implements CommandHandler<
  Command<RecordAuditCommandData>,
  OrganizationAuditRecordedEvent
> {
  static readonly schema = defineCommandSchema(
    RECORD_AUDIT_COMMAND_TYPE,
    recordAuditCommandDataSchema,
    "Record an audited organization change",
  );

  handle(command: Command<RecordAuditCommandData>): OrganizationAuditRecordedEvent[] {
    const data = command.data;
    return [
      EventUtils.createEvent<OrganizationAuditRecordedEvent>({
        aggregateType: ORGANIZATION_AGGREGATE_TYPE,
        aggregateId: RecordAuditCommand.getAggregateId(data),
        tenantId: createTenantId(command.tenantId),
        type: ORGANIZATION_AUDIT_RECORDED_EVENT_TYPE,
        version: ORGANIZATION_AUDIT_RECORDED_EVENT_VERSION,
        data,
        occurredAt: data.occurredAt,
        idempotencyKey: data.idempotencyKey,
      }),
    ];
  }

  /** The tenant's own stream: the organization, or a personal project with none. */
  static getAggregateId(payload: RecordAuditCommandData): string {
    return payload.tenantId;
  }
}
