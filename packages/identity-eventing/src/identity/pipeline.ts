import type { IdentityGuards, MfaGuards } from "@langwatch/identity-server";
import {
  defineAggregate,
  defineEvents,
  definePipeline,
  type StateProjectionStore,
} from "@langwatch/eventing";
import { IDENTITY_EVENT_TYPES, MFA_EVENT_TYPES } from "@langwatch/identity-contract";
import { AttachIdentifierCommand } from "./commands/attachIdentifier.command";
import { DetachIdentifierCommand } from "./commands/detachIdentifier.command";
import { EraseUserCommand } from "./commands/eraseUser.command";
import { MarkPrimaryCommand } from "./commands/markPrimary.command";
import {
  ConfirmMfaCommand,
  ConsumeBackupCodeCommand,
  DisableMfaCommand,
  EnrollMfaCommand,
  ExpireMfaEnrollmentCommand,
  RecordMfaVerificationFailureCommand,
  RegenerateBackupCodesCommand,
} from "./commands/mfaCommands";
import { ProposeLinkCommand } from "./commands/proposeLink.command";
import { VerifyIdentifierCommand } from "./commands/verifyIdentifier.command";
import {
  type IdentityFoldState,
  IdentityStateFoldProjection,
} from "./projections/identityState.foldProjection";
import {
  MfaEnrollmentStateFoldProjection,
  type MfaFoldState,
} from "./projections/mfaEnrollmentState.foldProjection";
import { IDENTITY_PIPELINE_NAME, USER_IDENTITY_AGGREGATE_TYPE } from "./schemas/constants";
import type { IdentityEvent } from "./schemas/events";
import type { MfaEvent } from "./schemas/mfaEvents";

export interface IdentityPipelineDeps {
  identityProjectionStore: StateProjectionStore<IdentityFoldState>;
  /** The guards every command handler runs — `@langwatch/identity-server`'s
   *  IdentityGuards over the app's heads repository, the same instance shape
   *  the calling path uses. */
  identityGuards: IdentityGuards;
  /** The `MfaEnrollment` head + cursor (D06), folded on this same pipeline. */
  mfaProjectionStore: StateProjectionStore<MfaFoldState>;
  /** The two-step verification guards, over the same person's state. */
  mfaGuards: MfaGuards;
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
 * It also carries two-step verification (D06). Different kind of thing, same
 * aggregate, because they share a key: an enrollment belongs to exactly the
 * person their identifiers belong to. `trace` does the same with spans, logs
 * and annotations.
 *
 * Sharing the aggregate is a CORRECTNESS property, not a tidiness one. The
 * queue composes its group key as
 * `${tenantId}/${jobPath}/${aggregateType}:${aggregateId}`, and here the
 * tenant IS the person, so one person's identifier commands and their
 * two-step commands land in the SAME lane and serialise against each other.
 * Turning two-step verification off and detaching a sign-in method cannot
 * interleave — each reads the state the other left. Split across two
 * aggregates they would have raced, and the strands guard could have read a
 * state that was already stale by the time it refused.
 *
 * There is nothing narrower to shard by (ADR-114's sharded per-organization
 * lane exists because many grants share one tenant), and a person holds a
 * handful of identifiers, so a lane never has a batch to coalesce either.
 */
/**
 * The identity pipeline as a TYPE, for the seams that hold one.
 *
 * Derived rather than restated: the definition's event union, projections and
 * command names all come from the builder below, and a hand-written twin of it
 * would be one command rename away from being a lie that still compiles.
 */
export type IdentityPipeline = ReturnType<typeof createIdentityPipeline>;

export function createIdentityPipeline(deps: IdentityPipelineDeps) {
  return definePipeline<IdentityEvent | MfaEvent>({
    name: IDENTITY_PIPELINE_NAME,
    aggregate: defineAggregate({
      type: USER_IDENTITY_AGGREGATE_TYPE,
      events: defineEvents([...IDENTITY_EVENT_TYPES, ...MFA_EVENT_TYPES]),
    }),
  })
    .withPostgresProjection(
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
    .withCommandInstance("eraseUser", EraseUserCommand, new EraseUserCommand(deps.identityGuards))
    .withCommandInstance(
      "proposeLink",
      ProposeLinkCommand,
      new ProposeLinkCommand(deps.identityGuards),
    )
    .withPostgresProjection(
      new MfaEnrollmentStateFoldProjection({
        store: deps.mfaProjectionStore,
      }),
    )
    .withCommandInstance("enrollMfa", EnrollMfaCommand, new EnrollMfaCommand(deps.mfaGuards))
    .withCommandInstance("confirmMfa", ConfirmMfaCommand, new ConfirmMfaCommand(deps.mfaGuards))
    .withCommandInstance(
      "expireMfaEnrollment",
      ExpireMfaEnrollmentCommand,
      new ExpireMfaEnrollmentCommand(deps.mfaGuards),
    )
    .withCommandInstance("disableMfa", DisableMfaCommand, new DisableMfaCommand(deps.mfaGuards))
    .withCommandInstance(
      "consumeBackupCode",
      ConsumeBackupCodeCommand,
      new ConsumeBackupCodeCommand(deps.mfaGuards),
    )
    .withCommandInstance(
      "regenerateBackupCodes",
      RegenerateBackupCodesCommand,
      new RegenerateBackupCodesCommand(deps.mfaGuards),
    )
    .withCommandInstance(
      "recordMfaVerificationFailure",
      RecordMfaVerificationFailureCommand,
      new RecordMfaVerificationFailureCommand(deps.mfaGuards),
    )
    .build();
}
