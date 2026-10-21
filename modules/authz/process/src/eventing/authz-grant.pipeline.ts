import {
  defineAggregate,
  defineEventingModule,
  definePipeline,
  type EventingSetup,
} from "@langwatch/eventing";
import { USER_ERASED_EVENT_TYPE, userErasedPayloadSchema } from "@langwatch/identity-contract";
import {
  TENANT_MIGRATION_ROLLED_BACK_EVENT_TYPE,
  tenantMigrationRolledBackEventDataSchema,
} from "@langwatch/ops-contract";
import {
  PROJECT_ARCHIVED_EVENT_TYPE,
  PROJECT_MOVED_EVENT_TYPE,
  projectArchivedEventDataSchema,
  projectMovedEventDataSchema,
} from "@langwatch/project-contract";
import { Temporal } from "@langwatch/time";
import {
  USER_DEACTIVATED_EVENT_TYPE,
  USER_REACTIVATED_EVENT_TYPE,
  userLifecycleEventDataSchema,
} from "@langwatch/user-contract";

import type { AuthzModule } from "../app/authz.app.ts";
import type { AuthzAuditTrailRepository } from "../repositories/authz-audit-trail.repository.ts";
import type { AuthzGrantProjectionRepository } from "../repositories/authz-grant-projection.repository.ts";
import type { AuthzLedgerReadRepository } from "../repositories/authz-ledger-read.repository.ts";
import type { AuthzRepositories } from "../repositories/authz.repositories.ts";
import { isEngineMigrationStep } from "../rules/authz-engine-switch.rules.ts";
import type { AuthzCutoverGateService } from "../services/authz-cutover-gate.service.ts";
import type { AuthzSessionVersionService } from "../services/authz-session-version.service.ts";
import type { AuthzUserStandingService } from "../services/authz-user-standing.service.ts";
import type { AuthzService } from "../services/authz.service.ts";
import {
  AttachGrantCommand,
  ChangeGrantRoleCommand,
  ChangeRolePermissionsCommand,
  DefineRoleCommand,
  DeleteRoleCommand,
  GRANT_COALESCE_MAX_BATCH,
  RevokeGrantCommand,
} from "./authz-grant.commands.ts";
import { AUTHZ_GRANT_AGGREGATE_TYPE, authzGrantEventSchemas } from "./authz-grant.events.ts";
import {
  AUTHZ_GRANTS_WRITE_PROJECTION_NAME,
  AuthzGrantProjection,
} from "./authz-grant.projection.ts";
import { EventingAuthzAuditAdapter } from "./authz-grant.subscriber.ts";

export const AUTHZ_GRANT_PIPELINE_NAME = "authz_grant" as const;

interface EventingAuthzAdapterOptions {
  authzGrantsWriteStore: AuthzGrantProjectionRepository;
  authzAuditTrailStore: AuthzAuditTrailRepository;
  /** Lets a revoked braid's audit entry name both projects and the condition (ADR-183 §2). */
  authzBraidReads?: Pick<AuthzLedgerReadRepository, "findBraids">;
  /** Absent on the consumer-only twin, which bumps no session version. */
  sessionVersions?: AuthzSessionVersionService;
  /** Absent on the consumer-only twin, which keeps no user standing. */
  userStandings?: AuthzUserStandingService;
  /** Absent on the consumer-only twin, which holds no scope lineage. */
  scopeLineage?: Pick<AuthzService, "lineageChanged">;
  /** Absent on the consumer-only twin, which keeps no engine switch. */
  engineSwitch?: Pick<AuthzCutoverGateService, "pin">;
}

const buildAuthzGrantPipeline = (options: EventingAuthzAdapterOptions) => {
  const pipeline = definePipeline({
    name: AUTHZ_GRANT_PIPELINE_NAME,
    aggregate: defineAggregate({
      type: AUTHZ_GRANT_AGGREGATE_TYPE,
    }),
  })
    .withEvents(authzGrantEventSchemas)
    .withClickHouseMapProjection(AuthzGrantProjection.create(options.authzGrantsWriteStore))
    .withEventSubscriber(
      "auditTrail",
      EventingAuthzAuditAdapter.create({
        store: options.authzAuditTrailStore,
        ...(options.authzBraidReads ? { braids: options.authzBraidReads } : {}),
      }),
    )
    // One grant per lane via serializeByAggregate: prevents same-grant
    // commands racing; batch folds one grant's jobs (ADR-114 amended).
    .withCommand("attachGrant", AttachGrantCommand, {
      serializeByAggregate: true,
      coalesceMaxBatch: GRANT_COALESCE_MAX_BATCH,
    })
    .withCommand("changeGrantRole", ChangeGrantRoleCommand, {
      serializeByAggregate: true,
      coalesceMaxBatch: GRANT_COALESCE_MAX_BATCH,
    })
    .withCommand("revokeGrant", RevokeGrantCommand, {
      serializeByAggregate: true,
      coalesceMaxBatch: GRANT_COALESCE_MAX_BATCH,
    })
    .withCommand("defineRole", DefineRoleCommand)
    .withCommand("changeRolePermissions", ChangeRolePermissionsCommand)
    .withCommand("deleteRole", DeleteRoleCommand);
  const { sessionVersions, userStandings, scopeLineage, engineSwitch } = options;
  if (engineSwitch) {
    // An operator's rollback is ops' fact; authz turns its own switch off (Alex, 2026-10-12).
    pipeline.withPeerSubscriber("engineMigrationRolledBack", {
      eventType: TENANT_MIGRATION_ROLLED_BACK_EVENT_TYPE,
      data: tenantMigrationRolledBackEventDataSchema,
      options: { enqueue: { filter: (data) => isEngineMigrationStep(data.stepId) } },
      handle: (data, { eventId, occurredAt }) =>
        isEngineMigrationStep(data.stepId)
          ? engineSwitch.pin({
              organizationId: data.rolledBackTenantId,
              at: Temporal.Instant.fromEpochMilliseconds(occurredAt),
              eventId,
            })
          : Promise.resolve(),
    });
  }
  if (scopeLineage) {
    // Where a project sits is project's fact; authz moves its own lineage signal from it (§9).
    pipeline
      .withPeerSubscriber("projectMoved", {
        eventType: PROJECT_MOVED_EVENT_TYPE,
        data: projectMovedEventDataSchema,
        handle: ({ organizationId }) => scopeLineage.lineageChanged({ organizationId }),
      })
      .withPeerSubscriber("projectArchived", {
        eventType: PROJECT_ARCHIVED_EVENT_TYPE,
        data: projectArchivedEventDataSchema,
        handle: ({ organizationId }) => scopeLineage.lineageChanged({ organizationId }),
      });
  }
  if (userStandings) {
    // Who is gone is user's and identity's fact; authz keeps its own table from them (§9).
    pipeline
      .withPeerSubscriber("userDeactivated", {
        eventType: USER_DEACTIVATED_EVENT_TYPE,
        data: userLifecycleEventDataSchema,
        handle: (data) => userStandings.deactivated(data),
      })
      .withPeerSubscriber("userReactivated", {
        eventType: USER_REACTIVATED_EVENT_TYPE,
        data: userLifecycleEventDataSchema,
        handle: (data) => userStandings.reactivated(data),
      })
      .withPeerSubscriber("userErased", {
        eventType: USER_ERASED_EVENT_TYPE,
        data: userErasedPayloadSchema,
        handle: ({ userId }, { occurredAt }) => userStandings.erased({ userId, occurredAt }),
      });
  }
  if (!sessionVersions) return pipeline.build();

  // Bound to the projection so a bump never lands before the change is readable (ADR-170).
  return pipeline
    .withProjectionSubscriber("sessionVersion", {
      map: AUTHZ_GRANTS_WRITE_PROJECTION_NAME,
      handler: (event) => sessionVersions.bumpFor({ organizationId: event.tenantId, event }),
    })
    .build();
};

export type AuthzGrantPipeline = ReturnType<typeof buildAuthzGrantPipeline>;

/**
 * Explicit composition boundary for the AuthZ Eventing topology. Importing
 * this module creates no pipeline and registers nothing with a runtime.
 */
export class EventingAuthzAdapter {
  private constructor(private readonly options: EventingAuthzAdapterOptions) {}

  static create(options: EventingAuthzAdapterOptions): EventingAuthzAdapter {
    return new EventingAuthzAdapter(options);
  }

  static build(options: EventingAuthzAdapterOptions): AuthzGrantPipeline {
    return EventingAuthzAdapter.create(options).build();
  }

  build(): AuthzGrantPipeline {
    return buildAuthzGrantPipeline(this.options);
  }
}

export const authzEventing = defineEventingModule({
  pipeline: AUTHZ_GRANT_PIPELINE_NAME,
  build: ({ app }: EventingSetup<AuthzRepositories, AuthzModule>) => app.eventingPipeline(),
  connect: ({ app, commands }) => app.connectCommands(commands),
});
