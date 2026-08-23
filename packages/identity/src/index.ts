/**
 * @langwatch/identity — the isomorphic identity core (ADR-101, ADR-115).
 *
 * The frontend and the backend import this package verbatim, so it reads
 * nothing and writes nothing: no Prisma, no env, no node built-ins. What
 * lives here is what both sides must agree on — the identifier vocabulary,
 * value normalization, the fact and command shapes, the pure reducer, the
 * refusal errors, and the backfill's parity policy. Everything that derives
 * an id (node:crypto), reads a head, or appends a fact is
 * `@langwatch/identity-server`.
 */
export {
  type BackfillDiff,
  type BackfillIdentifierRow,
  backfillParityDiffs,
  type ExpectedIdentifier,
  identifierStateSatisfies,
  orphanedIdentifierRows,
} from "./backfill";
export {
  IdentityCommandRefusedError,
  IdentityIdentifierNotFoundError,
  IdentityIdentifierNotVerifiableError,
  IdentityPrimaryMustDemoteFirstError,
  IdentityPrimaryRequiresVerifiedError,
  IdentityVerificationExpiredError,
  IdentityVerificationInvalidError,
} from "./errors";
export {
  ATTACH_IDENTIFIER_COMMAND_TYPE,
  type AttachIdentifierCommandData,
  attachIdentifierCommandDataSchema,
  DETACH_IDENTIFIER_COMMAND_TYPE,
  type DetachIdentifierCommandData,
  detachIdentifierCommandDataSchema,
  ERASE_USER_COMMAND_TYPE,
  emptyIdentityHeads,
  type EraseUserCommandData,
  eraseUserCommandDataSchema,
  IDENTIFIER_ATTACHED_EVENT_TYPE,
  IDENTIFIER_DEAD_ENDED_EVENT_TYPE,
  IDENTIFIER_DETACHED_EVENT_TYPE,
  IDENTIFIER_VERIFIED_EVENT_TYPE,
  IDENTITY_COMMAND_TYPES,
  IDENTITY_EVENT_TYPES,
  IDENTITY_EVENT_VERSION_LATEST,
  type IdentifierFact,
  type IdentityCommand,
  type IdentityCommandType,
  type IdentityEventType,
  type IdentityFact,
  type IdentityFactInput,
  type IdentityFactOf,
  type IdentityHeads,
  identifierAttachedPayloadSchema,
  identifierDeadEndedPayloadSchema,
  identifierDetachedPayloadSchema,
  identifierVerifiedPayloadSchema,
  identityFactInputSchema,
  MARK_PRIMARY_COMMAND_TYPE,
  type MarkPrimaryCommandData,
  markPrimaryCommandDataSchema,
  PRIMARY_CHANGED_EVENT_TYPE,
  primaryChangedPayloadSchema,
  USER_ERASED_EVENT_TYPE,
  userErasedPayloadSchema,
  VERIFY_IDENTIFIER_COMMAND_TYPE,
  type VerifyIdentifierCommandData,
  verifyIdentifierCommandDataSchema,
} from "./facts";
export { identifierDomain, normalizeIdentifierValue } from "./identifier";
export { reduceIdentity } from "./reduce";
export {
  arrivalStateForProvider,
  IDENTIFIER_LIFECYCLE_STATES,
  IDENTIFIER_PROVIDERS,
  type IdentifierArrivalState,
  type IdentifierLifecycleState,
  type IdentifierProvider,
  type IdentityActor,
  identifierArrivalStateSchema,
  identifierProviderFor,
  identifierProviderSchema,
  identityActorSchema,
  isLiveIdentifierState,
  type VerificationMethod,
  verificationMethodSchema,
} from "./vocabulary";
