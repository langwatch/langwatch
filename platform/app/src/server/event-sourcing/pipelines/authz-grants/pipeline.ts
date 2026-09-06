import { definePipeline } from "../..";
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

/**
 * How many of ONE grant's queued same-command jobs fold into a single insert.
 * A ceiling on a redelivery or retry pile-up for one grant, not a throughput
 * lever: distinct grants keep distinct lanes and never share a batch.
 */
export const GRANT_COALESCE_MAX_BATCH = 50;

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
      // The batch bound stays, and means something narrower than it did: it
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
