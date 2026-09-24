import {
  defineAggregate,
  definePipeline,
  type Projection,
  type RegisteredCommand,
  type StateProjectionStore,
  type StaticPipelineDefinition,
} from "@langwatch/eventing";
import { IDENTITY_PIPELINE_NAME, USER_IDENTITY_AGGREGATE_TYPE } from "@langwatch/identity-contract";

import { AttachIdentifierCommand } from "../eventing/attach-identifier.intent.ts";
import { DetachIdentifierCommand } from "../eventing/detach-identifier.intent.ts";
import { EraseUserCommand } from "../eventing/erase-user.intent.ts";
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
} from "../eventing/identity-state.projection.ts";
import { MarkPrimaryCommand } from "../eventing/mark-primary.intent.ts";
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
} from "../eventing/mfa-enrollment-state.projection.ts";
import {
  ConfirmMfaCommand,
  ConsumeBackupCodeCommand,
  DisableMfaCommand,
  EnrollMfaCommand,
  ExpireMfaEnrollmentCommand,
  RecordMfaVerificationFailureCommand,
  RegenerateBackupCodesCommand,
} from "../eventing/mfa.intent.ts";
import { ProposeLinkCommand } from "../eventing/propose-link.intent.ts";
import { VerifyIdentifierCommand } from "../eventing/verify-identifier.intent.ts";
import type { IdentityGuardsService } from "./identity-guards.service.ts";
import type { MfaGuardsService } from "./mfa-guards.service.ts";

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
export type IdentityPipeline = ReturnType<typeof IdentityPipelineDefinitionAdapter.create>;

export class IdentityPipelineDefinitionAdapter {
  static create(
    deps: IdentityPipelineDeps,
  ): StaticPipelineDefinition<
    IdentityEvent | MfaEvent,
    Record<string, Projection>,
    RegisteredCommand
  > {
    return definePipeline<IdentityEvent | MfaEvent>({
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
}
