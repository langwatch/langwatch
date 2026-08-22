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
  AUTHZ_GRANT_EVENT_TYPES,
  AUTHZ_GRANT_PIPELINE_NAME,
  AUTHZ_ROLE_AGGREGATE_TYPE,
  AUTHZ_ROLE_EVENT_TYPES,
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
 * Both families ride this one pipeline under their own aggregate types
 * (ADR-113): the store checks each event's type against the aggregate that
 * owns it, a role command binds to `authz_role` so its queue and kill-switch
 * keys carry that type, and what places an event is the aggregate id its
 * command stamped.
 */
export function createAuthzGrantsPipeline(deps: AuthzGrantsPipelineDeps) {
  return definePipeline<AuthzGrantsEvent>()
    .withName(AUTHZ_GRANT_PIPELINE_NAME)
    .withAggregateTypes({
      [AUTHZ_GRANT_AGGREGATE_TYPE]: AUTHZ_GRANT_EVENT_TYPES,
      [AUTHZ_ROLE_AGGREGATE_TYPE]: AUTHZ_ROLE_EVENT_TYPES,
    })
    .withMapProjection(
      AUTHZ_GRANTS_WRITE_PROJECTION_NAME,
      new AuthzGrantsWriteProjection({ store: deps.authzGrantsWriteStore }),
    )
    .withSubscriber(
      "auditTrail",
      createAuthzAuditTrailSubscriber({ store: deps.authzAuditTrailStore }),
    )
    .withCommand("attachGrant", AttachGrantCommand, {
      aggregateType: AUTHZ_GRANT_AGGREGATE_TYPE,
    })
    .withCommand("changeGrantRole", ChangeGrantRoleCommand, {
      aggregateType: AUTHZ_GRANT_AGGREGATE_TYPE,
    })
    .withCommand("revokeGrant", RevokeGrantCommand, {
      aggregateType: AUTHZ_GRANT_AGGREGATE_TYPE,
    })
    .withCommand("defineRole", DefineRoleCommand, {
      aggregateType: AUTHZ_ROLE_AGGREGATE_TYPE,
    })
    .withCommand("changeRolePermissions", ChangeRolePermissionsCommand, {
      aggregateType: AUTHZ_ROLE_AGGREGATE_TYPE,
    })
    .withCommand("deleteRole", DeleteRoleCommand, {
      aggregateType: AUTHZ_ROLE_AGGREGATE_TYPE,
    })
    .build();
}
