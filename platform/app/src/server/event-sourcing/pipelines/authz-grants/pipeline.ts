import { definePipeline } from "../..";
import {
  GRANT_COALESCE_MAX_BATCH,
  grantCommandLane,
} from "./commands/grantCommandLane";
import {
  AttachGrantCommand,
  ChangeGrantRoleCommand,
  ChangeRolePermissionsCommand,
  DefineRoleCommand,
  DeleteRoleCommand,
  RevokeGrantCommand,
} from "./commands/grantsLedgerCommands";
import {
  AUTHZ_GRANTS_WRITE_PROJECTION_NAME,
  AuthzGrantsWriteProjection,
  type GrantProjectionWriteStore,
} from "./projections/authzGrantsWrite.projection";
import {
  AUTHZ_GRANT_AGGREGATE_TYPE,
  AUTHZ_GRANT_PIPELINE_NAME,
} from "./schemas/constants";
import type { AuthzGrantsEvent } from "./schemas/events";
import {
  type AuthzAuditTrailStore,
  createAuthzAuditTrailSubscriber,
} from "./subscribers/authzAuditTrail.subscriber";

export interface AuthzGrantsPipelineDeps {
  /** Writes one guarded statement per event into the Grant and Role tables. */
  authzGrantsWriteStore: GrantProjectionWriteStore;
  /** Insert-only sink for the audit trail. One method, so the pipeline never
   *  names a storage engine. */
  authzAuditTrailStore: AuthzAuditTrailStore;
}

/**
 * The authorization pipeline (ADR-110).
 *
 * A grant is its own aggregate and so is a role, so a command names one
 * entity and its events apply independently of every other. The organization
 * is the tenant of all of them and the aggregate of none.
 *
 * Both families ride this one pipeline, so both stamp its aggregate TYPE —
 * that is not a label. It is the storage partition key, and the event store
 * refuses at append any event whose type differs from the one declared here.
 * What separates one entity's fold from another's is the aggregate ID its
 * command stamped: a grant id, or a role id.
 */
export function createAuthzGrantsPipeline(deps: AuthzGrantsPipelineDeps) {
  return (
    definePipeline<AuthzGrantsEvent>()
      .withName(AUTHZ_GRANT_PIPELINE_NAME)
      .withAggregateType(AUTHZ_GRANT_AGGREGATE_TYPE)
      .withMapProjection(
        AUTHZ_GRANTS_WRITE_PROJECTION_NAME,
        new AuthzGrantsWriteProjection({ store: deps.authzGrantsWriteStore }),
      )
      .withSubscriber(
        "auditTrail",
        createAuthzAuditTrailSubscriber({ store: deps.authzAuditTrailStore }),
      )
      // ADR-114: the three grant commands a bulk producer emits in volume share
      // a sharded per-organization lane, so their appends coalesce instead of
      // spending one ClickHouse statement each. The fold is untouched — state is
      // still one grant, keyed by its own id (ADR-110). The role commands keep
      // the default per-aggregate lane: a role is a rare, human-sized entity and
      // an organization has a handful, so there is nothing to batch.
      .withCommand("attachGrant", AttachGrantCommand, {
        getGroupKey: (payload) =>
          grantCommandLane({
            aggregateId: AttachGrantCommand.getAggregateId(payload),
          }),
        coalesceMaxBatch: GRANT_COALESCE_MAX_BATCH,
      })
      .withCommand("changeGrantRole", ChangeGrantRoleCommand, {
        getGroupKey: (payload) =>
          grantCommandLane({
            aggregateId: ChangeGrantRoleCommand.getAggregateId(payload),
          }),
        coalesceMaxBatch: GRANT_COALESCE_MAX_BATCH,
      })
      .withCommand("revokeGrant", RevokeGrantCommand, {
        getGroupKey: (payload) =>
          grantCommandLane({
            aggregateId: RevokeGrantCommand.getAggregateId(payload),
          }),
        coalesceMaxBatch: GRANT_COALESCE_MAX_BATCH,
      })
      .withCommand("defineRole", DefineRoleCommand)
      .withCommand("changeRolePermissions", ChangeRolePermissionsCommand)
      .withCommand("deleteRole", DeleteRoleCommand)
      .build()
  );
}
