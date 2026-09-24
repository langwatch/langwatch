import { defineAggregate, definePipeline } from "@langwatch/eventing";

import type { AuthzAuditTrailStore } from "../repositories/authz-audit-trail.repository.ts";
import type { AuthzGrantProjectionRepository } from "../repositories/authz-grant-projection.repository.ts";
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
import { AuthzGrantProjection } from "./authz-grant.projection.ts";
import { EventingAuthzAuditAdapter } from "./authz-grant.subscriber.ts";

export const AUTHZ_GRANT_PIPELINE_NAME = "authz_grant" as const;

export interface EventingAuthzAdapterOptions {
  authzGrantsWriteStore: AuthzGrantProjectionRepository;
  authzAuditTrailStore: AuthzAuditTrailStore;
}

const buildAuthzGrantPipeline = (options: EventingAuthzAdapterOptions) => {
  return (
    definePipeline({
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
};

/**
 * Explicit composition boundary for the AuthZ Eventing topology. Importing
 * this module creates no pipeline and registers nothing with a runtime.
 */
export class EventingAuthzAdapter {
  private constructor(private readonly options: EventingAuthzAdapterOptions) {}

  static create(options: EventingAuthzAdapterOptions): EventingAuthzAdapter {
    return new EventingAuthzAdapter(options);
  }

  static build(options: EventingAuthzAdapterOptions): ReturnType<typeof buildAuthzGrantPipeline> {
    return EventingAuthzAdapter.create(options).build();
  }

  build(): ReturnType<typeof buildAuthzGrantPipeline> {
    return buildAuthzGrantPipeline(this.options);
  }
}
