import type { IdentityGuards } from "../guards";
import type { MfaGuards } from "../mfa-guards";
import {
  defineAggregate,
  defineEvents,
  definePipeline,
  type StateProjectionStore,
} from "@langwatch/eventing";
import { IDENTITY_EVENT_TYPES, MFA_EVENT_TYPES } from "@langwatch/identity-contract";
import { AttachIdentifierCommand } from "../intents/attach-identifier.intent";
import { DetachIdentifierCommand } from "../intents/detach-identifier.intent";
import { EraseUserCommand } from "../intents/erase-user.intent";
import { MarkPrimaryCommand } from "../intents/mark-primary.intent";
import {
  ConfirmMfaCommand,
  ConsumeBackupCodeCommand,
  DisableMfaCommand,
  EnrollMfaCommand,
  ExpireMfaEnrollmentCommand,
  RecordMfaVerificationFailureCommand,
  RegenerateBackupCodesCommand,
} from "../intents/mfa.intent";
import { ProposeLinkCommand } from "../intents/propose-link.intent";
import { VerifyIdentifierCommand } from "../intents/verify-identifier.intent";
import {
  type IdentityEvent,
  type IdentityFoldState,
  IdentityStateFoldProjection,
} from "../projections/identity-state.projection";
import {
  MfaEnrollmentStateFoldProjection,
  type MfaEvent,
  type MfaFoldState,
} from "../projections/mfa-enrollment-state.projection";
import { IDENTITY_PIPELINE_NAME, USER_IDENTITY_AGGREGATE_TYPE } from "@langwatch/identity-contract";

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
 * The identity pipeline (ADR-101, D01). One aggregate per user; commands and
 * two-step verification (D06) share it, since a person's identifier and
 * two-step commands must serialise against each other.
 */
export type IdentityPipeline = ReturnType<typeof IdentityPipelineDefinitionAdapter.create>;

export class IdentityPipelineDefinitionAdapter {
  static create(deps: IdentityPipelineDeps) {
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
}
