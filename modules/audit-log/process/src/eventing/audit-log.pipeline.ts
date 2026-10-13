/**
 * Audit-log writes its own rows from organization's and billing's audit facts (Alex, 2026-10-06;
 * round 37 D3; record §9), so neither holds an audit-log peer.
 * Spec: modules/audit-log/specs/audit-log.feature
 */
import type { RecordAuditLogCommand } from "@langwatch/audit-log-contract";
import {
  BILLING_AUDIT_RECORDED_EVENT_TYPE,
  type BillingAuditRecordedEventData,
  billingAuditRecordedEventDataSchema,
} from "@langwatch/enterprise-billing-contract";
import {
  defineAggregate,
  defineEventingModule,
  definePipeline,
  type EventingSetup,
  type StaticPipelineDefinition,
} from "@langwatch/eventing";
import {
  ORGANIZATION_AUDIT_RECORDED_EVENT_TYPE,
  type OrganizationAuditRecordedEventData,
  organizationAuditRecordedEventDataSchema,
} from "@langwatch/organization-contract";

import type { AuditLogModule } from "../app/audit-log.app.ts";
import type { AuditLogRepositories } from "../repositories/audit-log.repositories.ts";
import type { AuditLogService } from "../services/audit-log.service.ts";

const AUDIT_LOG_PIPELINE_NAME = "audit_log" as const;

export type AuditLogPipeline = StaticPipelineDefinition<never>;

/** Organization's fact as an audit command; its key makes a redelivery write nothing new. */
function organizationAuditCommand(fact: OrganizationAuditRecordedEventData): RecordAuditLogCommand {
  return {
    idempotencyKey: fact.idempotencyKey,
    action: fact.action,
    ...(fact.organizationId === null ? {} : { organizationId: fact.organizationId }),
    ...(fact.projectId === undefined ? {} : { projectId: fact.projectId }),
    ...(fact.userId === undefined ? {} : { userId: fact.userId }),
    ...(fact.actorUserId == null ? {} : { actorUserId: fact.actorUserId }),
    ...(fact.metadata === undefined ? {} : { metadata: fact.metadata }),
    ...(fact.targetKind === undefined ? {} : { targetKind: fact.targetKind }),
    ...(fact.targetId === undefined ? {} : { targetId: fact.targetId }),
    ...(fact.before === undefined ? {} : { before: fact.before }),
    ...(fact.after === undefined ? {} : { after: fact.after }),
  };
}

/** Billing's operator command as main recorded it: no organization on the row, args kept. */
function billingAuditCommand(fact: BillingAuditRecordedEventData): RecordAuditLogCommand {
  return {
    idempotencyKey: fact.idempotencyKey,
    userId: fact.userId,
    action: fact.action,
    ...(fact.args === undefined ? {} : { args: fact.args }),
    targetKind: fact.targetKind,
    targetId: fact.targetId,
  };
}

export function buildAuditLogPipeline({
  entries,
}: {
  entries: Pick<AuditLogService, "record">;
}): AuditLogPipeline {
  return definePipeline({
    name: AUDIT_LOG_PIPELINE_NAME,
    // `global`: audit-log appends no events of its own; it only writes its peers' facts.
    aggregate: defineAggregate({ type: "global" }),
  })
    .withEvents([])
    .withPeerSubscriber("auditLogOrganizationAudit", {
      eventType: ORGANIZATION_AUDIT_RECORDED_EVENT_TYPE,
      data: organizationAuditRecordedEventDataSchema,
      handle: async (fact) => {
        await entries.record(organizationAuditCommand(fact));
      },
    })
    .withPeerSubscriber("auditLogBillingAudit", {
      eventType: BILLING_AUDIT_RECORDED_EVENT_TYPE,
      data: billingAuditRecordedEventDataSchema,
      handle: async (fact) => {
        await entries.record(billingAuditCommand(fact));
      },
    })
    .build();
}

export const auditLogEventing = defineEventingModule({
  pipeline: AUDIT_LOG_PIPELINE_NAME,
  build: ({ app }: EventingSetup<AuditLogRepositories, AuditLogModule>) => app.factsPipeline(),
});
