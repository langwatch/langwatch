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
        // ADR-114 (amended): every command about ONE grant rides ONE lane.
        // `serializeByAggregate` keys the lane on the grant id AND drops the
        // command NAME from the job path, so `attachGrant` and the `revokeGrant`
        // that follows it queue behind each other instead of racing in two lanes.
        //
        // The projection's guard cannot recover that order on its own. `revoked`
        // is a conditional UPDATE: a revoke that arrives before the row exists
        // matches nothing and writes nothing, and the late `attached` then
        // inserts a live row that no revocation contradicts. Ordering is the
        // queue's job, and this option is what makes the queue do it.
        //
        // The batch bound means something narrower than a throughput lever: it
        // folds ONE grant's own queued same-command jobs into a single insert —
        // the `serializeByAggregate` shape `queueManager` names, safe precisely
        // because those jobs share an aggregate. It buys no cross-grant economy,
        // and is not meant to.
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
