import {
  defineAggregate,
  definePipeline,
  type Projection,
  type RegisteredCommand,
  type StateProjectionStore,
  type StaticPipelineDefinition,
} from "@langwatch/eventing";
import { IDENTITY_PIPELINE_NAME, USER_IDENTITY_AGGREGATE_TYPE } from "@langwatch/identity-contract";

import type { IdentityReservationRepository } from "../repositories/identity-reservations.repository.ts";
import type { IdentityRepositories } from "../repositories/identity.repositories.ts";
import { CryptoIdentifierIdentityService } from "../services/crypto-identifier-identity.service.ts";
import { IdentityGuardsService } from "../services/identity-guards.service.ts";
import { MfaGuardsService } from "../services/mfa-guards.service.ts";
import { AttachIdentifierCommand } from "./attach-identifier.intent.ts";
import { DetachIdentifierCommand } from "./detach-identifier.intent.ts";
import { EraseUserCommand } from "./erase-user.intent.ts";
import {
  type IdentityEvent,
  type IdentityFoldState,
  IdentityStateFoldProjection,
  identifierAttachedEventSchema,
  identifierVerifiedEventSchema,
  identifierDeadEndedEventSchema,
  primaryChangedEventSchema,
  identifierDetachedEventSchema,
  userErasedEventSchema,
  linkProposedEventSchema,
} from "./identity-state.projection.ts";
import { MarkPrimaryCommand } from "./mark-primary.intent.ts";
import {
  MfaEnrollmentStateFoldProjection,
  type MfaEvent,
  type MfaFoldState,
  mfaEnrolledEventSchema,
  mfaConfirmedEventSchema,
  mfaEnrollmentExpiredEventSchema,
  mfaDisabledEventSchema,
  backupCodeConsumedEventSchema,
  backupCodesRegeneratedEventSchema,
  mfaVerificationFailedEventSchema,
} from "./mfa-enrollment-state.projection.ts";
import {
  ConfirmMfaCommand,
  ConsumeBackupCodeCommand,
  DisableMfaCommand,
  EnrollMfaCommand,
  ExpireMfaEnrollmentCommand,
  RecordMfaVerificationFailureCommand,
  RegenerateBackupCodesCommand,
} from "./mfa.intent.ts";
import { ProposeLinkCommand } from "./propose-link.intent.ts";
import { VerifyIdentifierCommand } from "./verify-identifier.intent.ts";

export interface IdentityPipelineDeps {
  identityProjectionStore: StateProjectionStore<IdentityFoldState>;
  /** The guards every command handler runs — `@langwatch/identity-process`'s
   *  IdentityGuardsService over the app's heads repository, the same instance shape
   *  the calling path uses. */
  identityGuards: IdentityGuardsService;
  /** The `MfaEnrollment` head + cursor (D06), folded on this same pipeline. */
  mfaProjectionStore: StateProjectionStore<MfaFoldState>;
  /** The two-step verification guards, over the same person's state. */
  mfaGuards: MfaGuardsService;
}

/**
 * The identity pipeline (ADR-101, D01). One aggregate per user; commands and
 * two-step verification (D06) share it, since a person's identifier and
 * two-step commands must serialise against each other.
 */
export type IdentityPipeline = StaticPipelineDefinition<
  IdentityEvent | MfaEvent,
  Record<string, Projection>,
  RegisteredCommand
>;

export function defineIdentityPipeline(deps: IdentityPipelineDeps): IdentityPipeline {
  return definePipeline({
    name: IDENTITY_PIPELINE_NAME,
    aggregate: defineAggregate({
      type: USER_IDENTITY_AGGREGATE_TYPE,
    }),
  })
    .withEvents([
      identifierAttachedEventSchema,
      identifierVerifiedEventSchema,
      identifierDeadEndedEventSchema,
      primaryChangedEventSchema,
      identifierDetachedEventSchema,
      userErasedEventSchema,
      linkProposedEventSchema,
      mfaEnrolledEventSchema,
      mfaConfirmedEventSchema,
      mfaEnrollmentExpiredEventSchema,
      mfaDisabledEventSchema,
      backupCodeConsumedEventSchema,
      backupCodesRegeneratedEventSchema,
      mfaVerificationFailedEventSchema,
    ])
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

/** The two guard instances, and the ONE address lock they claim through (ADR-116 §6). */
export type IdentityGuardsComposition = {
  identityGuards: IdentityGuardsService;
  mfaGuards: MfaGuardsService;
  reservations: IdentityReservationRepository;
};

export type IdentityGuardRepositories = Pick<
  IdentityRepositories,
  "heads" | "users" | "reservations" | "mfaEnrollment"
>;

export function composeIdentityGuards(
  repositories: IdentityGuardRepositories,
): IdentityGuardsComposition {
  return {
    identityGuards: IdentityGuardsService.create({
      heads: repositories.heads,
      users: repositories.users,
      reservations: repositories.reservations,
      identifiers: CryptoIdentifierIdentityService.create(),
    }),
    mfaGuards: MfaGuardsService.create(repositories.mfaEnrollment),
    reservations: repositories.reservations,
  };
}

/** The identity pipeline a draining process runs, over the module's own rows. */
export function composeIdentityPipeline(
  repositories: IdentityGuardRepositories &
    Pick<IdentityRepositories, "identityProjection" | "mfaProjection">,
): IdentityPipeline {
  const { identityGuards, mfaGuards } = composeIdentityGuards(repositories);
  return defineIdentityPipeline({
    identityProjectionStore: repositories.identityProjection,
    identityGuards,
    mfaProjectionStore: repositories.mfaProjection,
    mfaGuards,
  });
}
