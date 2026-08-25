import type { IdentityGuards } from "@langwatch/identity-server";
import { definePipeline } from "../..";
import type { StateProjectionStore } from "../../projections/stateProjection.types";
import { AttachIdentifierCommand } from "./commands/attachIdentifier.command";
import { DetachIdentifierCommand } from "./commands/detachIdentifier.command";
import { EraseUserCommand } from "./commands/eraseUser.command";
import { MarkPrimaryCommand } from "./commands/markPrimary.command";
import { VerifyIdentifierCommand } from "./commands/verifyIdentifier.command";
import {
  type IdentityFoldState,
  IdentityStateFoldProjection,
} from "./projections/identityState.foldProjection";
import {
  IDENTITY_PIPELINE_NAME,
  USER_IDENTITY_AGGREGATE_TYPE,
} from "./schemas/constants";
import type { IdentityEvent } from "./schemas/events";

export interface IdentityPipelineDeps {
  identityProjectionStore: StateProjectionStore<IdentityFoldState>;
  /** The guards every command handler runs — `@langwatch/identity-server`'s
   *  IdentityGuards over the app's heads repository, the same instance shape
   *  the calling path uses. */
  identityGuards: IdentityGuards;
}

/**
 * The identity pipeline (ADR-101, D01). One aggregate per user; commands
 * append (waited) and the operational projection folds into the Postgres
 * `Identifier` head in per-user FIFO. Its production writers are the
 * identity adapter and the identifier backfill, both through
 * `IdentityService` and the app's ledger writer, and both sit behind the
 * per-user write gate (app-layer/identity/write-gate.ts), which ships CLOSED
 * and opens only when a user's backfill is finalized - so deploying this
 * pipeline emits nothing on its own.
 *
 * Lanes: the commands keep the default per-aggregate group key. The queue
 * composes `${tenantId}/${jobPath}/${aggregateType}:${aggregateId}` and here
 * the tenant IS the user, so the default lane is already one per user and
 * there is nothing narrower to shard by (ADR-114's sharded per-organization
 * lane exists because many grants share one tenant). A user holds a handful
 * of identifiers, so a lane never has a batch to coalesce either.
 */
export function createIdentityPipeline(deps: IdentityPipelineDeps) {
  return definePipeline<IdentityEvent>()
    .withName(IDENTITY_PIPELINE_NAME)
    .withAggregateType(USER_IDENTITY_AGGREGATE_TYPE)
    .withProjection(
      "identityState",
      new IdentityStateFoldProjection({
        store: deps.identityProjectionStore,
      }),
    )
    .withCommandInstance(
      "attachIdentifier",
      AttachIdentifierCommand,
      new AttachIdentifierCommand(deps.identityGuards),
    )
    .withCommandInstance(
      "verifyIdentifier",
      VerifyIdentifierCommand,
      new VerifyIdentifierCommand(deps.identityGuards),
    )
    .withCommandInstance(
      "markPrimary",
      MarkPrimaryCommand,
      new MarkPrimaryCommand(deps.identityGuards),
    )
    .withCommandInstance(
      "detachIdentifier",
      DetachIdentifierCommand,
      new DetachIdentifierCommand(deps.identityGuards),
    )
    .withCommandInstance(
      "eraseUser",
      EraseUserCommand,
      new EraseUserCommand(deps.identityGuards),
    )
    .build();
}
