import { definePipeline } from "../..";
import type { StateProjectionStore } from "../../projections/stateProjection.types";
import {
  AttachIdentifierCommand,
  DetachIdentifierCommand,
  EraseUserCommand,
  type IdentityGuardReads,
  MarkPrimaryCommand,
  VerifyIdentifierCommand,
} from "./commands/identityCommands";
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
 * The identity pipeline (ADR-101, D01 PR 1). One aggregate per user;
 * commands append (waited) and the operational projection folds into the
 * Postgres `Identifier` head in per-user FIFO. Ships dark: registered so
 * the machinery is live and testable, but no production writer dispatches
 * these commands until the identity adapter lands with its per-user write
 * gate — which itself ships closed until a user's backfill (PR 2) latches.
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
