/**
 * organization_audit: a change's audit intent, committed with the change, records the audit fact
 * here, and audit-log writes its row from its own side (Alex, 2026-10-06; record §9).
 * Spec: modules/audit-log/specs/audit-log.feature
 */
import {
  defineAggregate,
  defineEventingModule,
  definePipeline,
  type EventingSetup,
  type ProcessStore,
} from "@langwatch/eventing";

import type { OrganizationModule } from "../app/organization.app.ts";
import type { OrganizationRepositories } from "../repositories/organization.repositories.ts";
import {
  ORGANIZATION_AUDIT_PROCESS_NAME,
  ORGANIZATION_AUDIT_PRUNE_INTENT,
  ORGANIZATION_AUDIT_RECORD_INTENT,
} from "../rules/organization-audit.rules.ts";
import {
  ORGANIZATION_AUDIT_PIPELINE_NAME,
  RecordAuditCommand,
  organizationAuditRecordedEventSchema,
  recordAuditCommandDataSchema,
} from "./organization-audit.commands.ts";
import {
  type OrganizationAuditSender,
  pruneAuditIntents,
  recordAuditFact,
} from "./organization-audit.intent.ts";
import {
  ORGANIZATION_AUDIT_INITIAL_STATE,
  ORGANIZATION_AUDIT_MAX_ATTEMPTS,
  ORGANIZATION_AUDIT_PRUNE_INTERVAL_MS,
  organizationAuditPruneSchema,
  organizationAuditPruneWake,
  organizationAuditStateSchema,
} from "./organization-audit.process.ts";
import { ORGANIZATION_AGGREGATE_TYPE } from "./organization-lifecycle.events.ts";

function auditPipeline(deps: {
  sender: () => OrganizationAuditSender | undefined;
  retention: Pick<ProcessStore, "deleteDispatchedBefore">;
}) {
  return definePipeline({
    name: ORGANIZATION_AUDIT_PIPELINE_NAME,
    aggregate: defineAggregate({ type: ORGANIZATION_AGGREGATE_TYPE }),
  })
    .withEvents([organizationAuditRecordedEventSchema])
    .withCommand("recordAudit", RecordAuditCommand)
    .withProcessManager(ORGANIZATION_AUDIT_PROCESS_NAME, (pm) =>
      pm
        .state(organizationAuditStateSchema, ORGANIZATION_AUDIT_INITIAL_STATE)
        .intent(
          ORGANIZATION_AUDIT_RECORD_INTENT,
          recordAuditCommandDataSchema,
          recordAuditFact(deps.sender),
        )
        .intent(
          ORGANIZATION_AUDIT_PRUNE_INTENT,
          organizationAuditPruneSchema,
          pruneAuditIntents(deps.retention),
        )
        .schedule({ everyMs: ORGANIZATION_AUDIT_PRUNE_INTERVAL_MS })
        .onWake(organizationAuditPruneWake)
        .outbox({ maxAttempts: ORGANIZATION_AUDIT_MAX_ATTEMPTS }),
    );
}

export type OrganizationAuditDefinition = ReturnType<ReturnType<typeof auditPipeline>["build"]>;

export function buildOrganizationAuditPipeline(deps: {
  sender: () => OrganizationAuditSender | undefined;
  retention: Pick<ProcessStore, "deleteDispatchedBefore">;
}): OrganizationAuditDefinition {
  return auditPipeline(deps).build();
}

export const organizationAuditEventing = defineEventingModule({
  pipeline: ORGANIZATION_AUDIT_PIPELINE_NAME,
  build: ({ app, processStore }: EventingSetup<OrganizationRepositories, OrganizationModule>) =>
    app.auditPipeline({ processStore }),
  connect: ({ app, commands }) => app.connectAudit(commands),
});
