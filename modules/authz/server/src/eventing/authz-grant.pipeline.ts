import { AUTHZ_GRANTS_EVENT_TYPES } from "@langwatch/authz-contract";
import { defineAggregate, defineEvents, definePipeline } from "@langwatch/eventing";
import { AuthzGrantProjection } from "../projections/authz-grant.projection.ts";
import type { GrantProjectionWriteStore } from "../projections/authz-grant.projection.ts";
import { AuthzAuditTrailStore } from "../repositories/authz-audit-trail.repository.ts";
import { AUTHZ_GRANT_AGGREGATE_TYPE, type AuthzGrantsEvent } from "./authz-grant.events.ts";
import {
  AttachGrantCommand,
  ChangeGrantRoleCommand,
  ChangeRolePermissionsCommand,
  DefineRoleCommand,
  DeleteRoleCommand,
  GRANT_COALESCE_MAX_BATCH,
  RevokeGrantCommand,
} from "./authz-grant.commands.ts";
import { EventingAuthzAuditAdapter } from "./authz-grant.subscriber.ts";

export const AUTHZ_GRANT_PIPELINE_NAME = "authz_grant" as const;

export interface EventingAuthzAdapterOptions {
  authzGrantsWriteStore: GrantProjectionWriteStore;
  authzAuditTrailStore: AuthzAuditTrailStore;
}

/**
 * Explicit composition boundary for the AuthZ Eventing topology. Importing
 * this module creates no pipeline and registers nothing with a runtime.
 */
export class EventingAuthzAdapter {
  private constructor(private readonly options: EventingAuthzAdapterOptions) {}

  static create(options: EventingAuthzAdapterOptions): EventingAuthzAdapter {
    return new EventingAuthzAdapter(options);
  }

  static build(options: EventingAuthzAdapterOptions) {
    return EventingAuthzAdapter.create(options).build();
  }

  build() {
    return (
      definePipeline<AuthzGrantsEvent>({
        name: AUTHZ_GRANT_PIPELINE_NAME,
        aggregate: defineAggregate({
          type: AUTHZ_GRANT_AGGREGATE_TYPE,
          events: defineEvents(AUTHZ_GRANTS_EVENT_TYPES),
        }),
      })
        .withClickHouseMapProjection(
          AuthzGrantProjection.create(this.options.authzGrantsWriteStore),
        )
        .withEventSubscriber(
          "auditTrail",
          EventingAuthzAuditAdapter.create({
            store: this.options.authzAuditTrailStore,
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
        .withCommand("deleteRole", DeleteRoleCommand)
        .build()
    );
  }
}
