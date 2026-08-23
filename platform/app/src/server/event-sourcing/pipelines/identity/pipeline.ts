import { definePipeline } from "../..";
import type { StateProjectionStore } from "../../projections/stateProjection.types";
import { AttachIdentifierCommand } from "./commands/attachIdentifier.command";
import { DetachIdentifierCommand } from "./commands/detachIdentifier.command";
import { EraseUserCommand } from "./commands/eraseUser.command";
import type { IdentityGuardReads } from "./commands/identityGuardReads";
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
  /** How command guards see current state — Postgres reads over the
   *  Identifier projection and User.userHashKey; in-memory in tests. */
  identityGuardReads: IdentityGuardReads;
}

/**
 * The identity pipeline (ADR-101, D01). One aggregate per user; commands
 * append (waited) and the operational projection folds into the Postgres
 * `Identifier` head in per-user FIFO. Its production writers are the
 * identity adapter (better-auth/identityDatabase.ts) and the identifier
 * backfill, and both sit behind the per-user write gate
 * (app-layer/identity/identifier-write-gate.ts), which ships CLOSED and
 * opens only when a user's backfill is finalized - so deploying this
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
      new AttachIdentifierCommand(deps.identityGuardReads),
    )
    .withCommandInstance(
      "verifyIdentifier",
      VerifyIdentifierCommand,
      new VerifyIdentifierCommand(deps.identityGuardReads),
    )
    .withCommandInstance(
      "markPrimary",
      MarkPrimaryCommand,
      new MarkPrimaryCommand(deps.identityGuardReads),
    )
    .withCommandInstance(
      "detachIdentifier",
      DetachIdentifierCommand,
      new DetachIdentifierCommand(deps.identityGuardReads),
    )
    .withCommandInstance(
      "eraseUser",
      EraseUserCommand,
      new EraseUserCommand(deps.identityGuardReads),
    )
    .build();
}
