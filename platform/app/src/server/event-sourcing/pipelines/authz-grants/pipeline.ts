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
 * The declared aggregate type is a label: it names the killswitch keys, and
 * nothing routes on it. Both families ride this one pipeline; what places an
 * event is the aggregate id its command stamped.
 */
export function createAuthzGrantsPipeline(deps: AuthzGrantsPipelineDeps) {
  return definePipeline<AuthzGrantsEvent>()
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
    .withCommand("attachGrant", AttachGrantCommand)
    .withCommand("changeGrantRole", ChangeGrantRoleCommand)
    .withCommand("revokeGrant", RevokeGrantCommand)
    .withCommand("defineRole", DefineRoleCommand)
    .withCommand("changeRolePermissions", ChangeRolePermissionsCommand)
    .withCommand("deleteRole", DeleteRoleCommand)
    .build();
}
