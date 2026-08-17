import { definePipeline } from "../..";
import type { StateProjectionStore } from "../../projections/stateProjection.types";
import {
  AttachGrantsCommand,
  ChangeGrantRoleCommand,
  CompleteCutoverCommand,
  DefineRolesCommand,
  DeleteRoleCommand,
  OffboardMemberCommand,
  ProveMigrationParityCommand,
  RecordMigrationTenantStateCommand,
  RevokeGrantsCommand,
  RollBackCutoverCommand,
} from "./commands/grantsLedgerCommands";
import {
  type AuthzGrantsFoldState,
  AuthzGrantsStateFoldProjection,
} from "./projections/authzGrantsState.foldProjection";
import {
  AUTHZ_GRANTS_AGGREGATE_TYPE,
  AUTHZ_GRANTS_PIPELINE_NAME,
} from "./schemas/constants";
import type { AuthzGrantsEvent } from "./schemas/events";

export interface AuthzGrantsPipelineDeps {
  authzGrantsProjectionStore: StateProjectionStore<AuthzGrantsFoldState>;
}

/**
 * The grants ledger pipeline (ADR-092 §13). One aggregate per organization;
 * commands append (waited) and the operational projection folds through the
 * queue in per-org FIFO into the two-headed Postgres store. Ships dark in
 * PR 1: registered so the machinery is live and testable, but no production
 * writer calls the commands until the backfill refactor and PR 2 move the
 * write paths.
 */
export function createAuthzGrantsPipeline(deps: AuthzGrantsPipelineDeps) {
  return definePipeline<AuthzGrantsEvent>()
    .withName(AUTHZ_GRANTS_PIPELINE_NAME)
    .withAggregateType(AUTHZ_GRANTS_AGGREGATE_TYPE)
    .withProjection(
      "authzGrantsState",
      new AuthzGrantsStateFoldProjection({
        store: deps.authzGrantsProjectionStore,
      }),
    )
    .withCommand("attachGrants", AttachGrantsCommand)
    .withCommand("changeGrantRole", ChangeGrantRoleCommand)
    .withCommand("revokeGrants", RevokeGrantsCommand)
    .withCommand("defineRoles", DefineRolesCommand)
    .withCommand("deleteRole", DeleteRoleCommand)
    .withCommand("offboardMember", OffboardMemberCommand)
    .withCommand("proveMigrationParity", ProveMigrationParityCommand)
    .withCommand("completeCutover", CompleteCutoverCommand)
    .withCommand("rollBackCutover", RollBackCutoverCommand)
    .withCommand(
      "recordMigrationTenantState",
      RecordMigrationTenantStateCommand,
    )
    .build();
}
