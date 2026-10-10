import type { Named } from "@langwatch/module";
import { z } from "zod";

export const ORGANIZATION_AUDIT_RECORDED_EVENT_TYPE = "lw.organization.audit_recorded" as const;
export const ORGANIZATION_AUDIT_RECORDED_EVENT_VERSION = "2026-10-06" as const;

/**
 * An audited organization change, committed with the change itself; audit-log writes its row
 * from its own side (Alex, 2026-10-06). Spec: modules/audit-log/specs/audit-log.feature
 */
const organizationAuditRecordedEventDataSchemaDefinition = z.object({
  tenantId: z.string().min(1),
  occurredAt: z.number().int().nonnegative(),
  /** An `audit` id minted once in the change's commit: a redelivered fact writes one row. */
  idempotencyKey: z.string().min(1),
  organizationId: z.string().min(1).nullable(),
  projectId: z.string().min(1).optional(),
  userId: z.string().min(1).optional(),
  /** Who really did it when that is not `userId`, such as whoever sent an accepted invite. */
  actorUserId: z.string().min(1).nullish(),
  action: z.string().min(1),
  metadata: z.json().optional(),
  targetKind: z.string().min(1).optional(),
  targetId: z.string().min(1).optional(),
  before: z.json().optional(),
  after: z.json().optional(),
});
export interface OrganizationAuditRecordedEventDataSchema extends Named<
  typeof organizationAuditRecordedEventDataSchemaDefinition
> {}
export const organizationAuditRecordedEventDataSchema: OrganizationAuditRecordedEventDataSchema =
  organizationAuditRecordedEventDataSchemaDefinition;
export type OrganizationAuditRecordedEventData = z.infer<
  typeof organizationAuditRecordedEventDataSchema
>;
