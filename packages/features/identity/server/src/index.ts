/**
 * @langwatch/identity-server — the server-side runtime of the identity
 * platform (ADR-101, ADR-115): guards, services and crypto over the app's
 * heads/ledger/records ports. The pure half is `@langwatch/identity-contract`.
 */
export {
  computeIdentifierHash,
  deriveIdentifierId,
  deriveNewbornUserId,
} from "./crypto/identifier-identity";
export { s256Challenge } from "./crypto/pkce";
export { mintUserHashKey } from "./crypto/user-hash-key";
export { IdentityGuards } from "./guards";
export {
  type BackfillAccountRow,
  type BackfillUserRow,
  type IdentityBackfillRepository,
} from "./identity-backfill.repository";
export { type PlannedIdentifier, planIdentifiers } from "./identity-backfill-plan";
export {
  IDENTITY_BACKFILL_ACTOR,
  type IdentityBackfillOutcome,
  IdentityBackfillService,
  type IdentityBackfillServiceDeps,
} from "./identity-backfill.service";
export { IdentityEmailService } from "./identity-email.service";
/**
 * The synthetic issuer better-auth 1.7 expects on an account row. Exported
 * from the root, not just `./better-auth`, because it is a PERSISTED format
 * every writer of a credential account row must reach and reuse.
 */
export { issuerForProviderId } from "./better-auth/account-queries";
/**
 * The row mappings the fold writes through and every guard reads back through.
 * The identity platform's event-sourcing layer (ADR-101, ADR-115, ADR-116,
 * ADR-117), folded into this package in the core-application exit: the
 */
export { IdentityProducerPipelinesAdapter } from "./adapters/producer.identity-pipelines.adapter";
export {
  type IdentityPipelineDatabase,
  PostgresIdentityPipelineAdapter,
  type PostgresIdentityPipelineOptions,
} from "./adapters/postgres.identity-pipeline.adapter";
export {
  PostgresJoinRequestPipelineAdapter,
  type JoinRequestPipelineDatabase,
  type PostgresJoinRequestPipelineOptions,
} from "./adapters/postgres.join-request-pipeline.adapter";
export {
  PostgresScimSyncPipelineAdapter,
  type PostgresScimSyncPipelineOptions,
  type ScimSyncPipelineDatabase,
} from "./adapters/postgres.scim-sync-pipeline.adapter";
export {
  PostgresSsoConnectionPipelineAdapter,
  type PostgresSsoConnectionPipelineOptions,
  type SsoConnectionPipelineDatabase,
} from "./adapters/postgres.sso-connection-pipeline.adapter";
export type { IdentityPipeline } from "./adapters/identity-pipeline-definition.adapter";
export type { JoinRequestPipeline } from "./adapters/join-request-pipeline-definition.adapter";
export type { ScimSyncPipeline } from "./adapters/scim-sync-pipeline-definition.adapter";
/** The day-7-reminder/day-14-expiry process manager's registered name, named
 *  by a caller that asserts on which process a wake dispatched through. */
export { JOIN_REQUEST_LIFECYCLE_PROCESS_NAME } from "./processes/join-request-lifecycle.process";
export {
  type IdentityGuardsComposition,
  type IdentityGuardsDatabase,
  PostgresIdentityGuardsAdapter,
  type PostgresIdentityGuardsOptions,
} from "./adapters/postgres.identity-guards.adapter";
export {
  IDENTITY_LATCH_CACHE_MAX_USERS,
  IDENTITY_LATCH_CACHE_TTL_MS,
  PostgresIdentityEmailAdapter,
  type PostgresIdentityEmailAdapterOptions,
} from "./adapters/postgres.identity-email.adapter";
export {
  type AccountSecretPair,
  IdentitySecretCarryService,
  type IdentitySecretCarryOutcome,
  type IdentitySecretCarryRepository,
} from "./identity-secret-carry.service";
export {
  adoptAccountCommandId,
  adoptUserEmailCommandId,
  detachOrphanCommandId,
  establishUserEmailCommandId,
  newIdentityCommandId,
} from "./identity-command-id";
export type { IdentityHeadsReader, IdentityHeadsRepository } from "./identity-heads.repository";
export type {
  IdentifierReservationHolder,
  IdentityReservationRepository,
} from "./identity-reservations.repository";
export type { IdentityLedger } from "./identity-ledger";
export type { IdentityUserGate } from "./identity-user-gate";
export type { IdentityUsersRepository } from "./identity-users.repository";
export type {
  IdentityVerificationRecord,
  IdentityVerificationRepository,
} from "./identity-verification.repository";
export { IdentityService } from "./identity.service";
export type { MfaEnrollmentRepository } from "./mfa-enrollment.repository";
export { MfaGuards } from "./mfa-guards";
export {
  type SignInBreakGlassLimiter,
  type SignInDomainRoutingPort,
  type SignInMethodPolicyPort,
  type SignInRouteRequest,
  SignInRouterService,
  type SignInRouterDeps,
  type SignInRoutingRecord,
  type SignInRoutingRecorder,
} from "./signin-router.service";
export type {
  IdentityAdoptionWrites,
  IdentityCeremonyWrites,
  IdentityLinkProposalWrites,
  IdentityVerificationWrites,
} from "./identity-writes";
export { IdentityJitDisabledError, IdentityLinkProposedError } from "./signin-callback-errors";
export {
  type CallbackAssertion,
  type CallbackAuditRecord,
  type CallbackLinkOutcome,
  type CallbackUserMatch,
  type SignInCallbackAudit,
  type SignInCallbackDirectoryPort,
  SignInCallbackLinkingService,
  type SignInCallbackLinkingDeps,
} from "./signin-callback-linking.service";
export {
  PostgresJoinRequestNotificationAdapter,
  type JoinRequestNotificationDatabase,
  type PostgresJoinRequestNotificationOptions,
} from "./adapters/postgres.join-request-notification.adapter";
export { JoinRequestGuards, type JoinRequestGuardsDeps } from "./join-request-guards";
export { JoinRequestAudiencePort } from "./ports/join-request-audience.port";
export { JoinRequestMailPort } from "./ports/join-request-mail.port";
export { JoinRequestNotificationService } from "./services/join-request-notification.service";
export {
  approveJoinCommandId,
  expireJoinCommandId,
  newJoinRequestCommandId,
  newJoinRequestId,
} from "./join-request-id";
export type { JoinRequestLedger } from "./join-request-ledger";
export type { JoinCandidateRepository, JoinRequestReadRepository } from "./join-request.repository";
export { JoinRequestService } from "./join-request.service";
export { SCIM_APPLY_MAX_ATTEMPTS, ScimSyncGuards } from "./scim-sync-guards";
export { newScimSyncCommandId } from "./scim-sync-id";
export type { ScimSyncLedger } from "./scim-sync-ledger";
export type { ScimSyncReadRepository } from "./scim-sync.repository";
export {
  type LegacySsoOrganizationRepository,
  type SsoConnectionGrandfatherDeps,
  type SsoConnectionGrandfatherOutcome,
  SsoConnectionGrandfatherService,
} from "./sso-connection-grandfather.service";
export { SsoConnectionGuards, type SsoConnectionGuardsDeps } from "./sso-connection-guards";
export {
  grandfatherCommandId,
  grandfatheredSsoConnectionId,
  newSsoConnectionCommandId,
  newSsoConnectionId,
} from "./sso-connection-id";
export type { SsoConnectionLedger } from "./sso-connection-ledger";
export {
  ShadowComparingDomainRoutingRepository,
  type SsoConnectionRoutingShadowDeps,
  type SsoConnectionRoutingShadowRecord,
  type SsoConnectionRoutingShadowRecorder,
} from "./sso-connection-routing-shadow";
export type {
  SsoBreakGlassBindingRepository,
  SsoConnectionReadRepository,
  SsoConnectionStrandingRepository,
  SsoPlatformOperatorRepository,
} from "./sso-connection.repository";
export { SsoConnectionService } from "./sso-connection.service";
export {
  IDENTITY_VERIFICATION_TTL_MS,
  type MintedEmailVerification,
  VerificationCeremonyService,
  type VerificationCeremonyDeps,
} from "./verification-ceremony.service";

// --------------------------------------------------------------------------- The composition half
// the platform application used to own Every module below was `platform/app/src/server/app-
// layer/identity/`: the Postgres repositories the guards and the fold read and write through, the
// two ledger writers, the join-request orchestration around the event-sourced lifecycle, and the
// instance's sign-in method policy.
export { IdentityEventingPort } from "./ports/identity-eventing.port";
export { PlatformOperatorPort } from "./ports/platform-operator.port";
export {
  IDENTITY_CONVERGENCE_POLL_MS,
  IDENTITY_CONVERGENCE_TIMEOUT_MS,
  IdentityLedgerWriterAdapter,
  type IdentityLedgerWriterDeps,
  type IdentityStagedSender,
} from "./adapters/identity-ledger.adapter";
export {
  JOIN_REQUEST_CONVERGENCE_POLL_MS,
  JOIN_REQUEST_CONVERGENCE_TIMEOUT_MS,
  JoinRequestLedgerWriterAdapter,
  type JoinRequestLedgerWriterDeps,
  type JoinRequestStagedSender,
} from "./adapters/join-request-ledger.adapter";
export {
  EmailJoinRequestNotifier,
  JoinRequestLifecycleDispatcher,
  PrismaJoinMembership,
  PrismaJoinSettings,
} from "./adapters/join-request.adapters";
export { JoinRequestNotificationMailPort } from "./ports/join-request-notification-mail.port";
export { InProcessBreakGlassLimiterAdapter } from "./adapters/in-process-break-glass-limiter.adapter";
export { LocalDoorBreakGlassBindingAdapter } from "./adapters/local-door-break-glass-binding.adapter";
export { PrismaIdentityVerificationRepository } from "./repositories/prisma/prisma.identity-verification.repository";
export { PrismaIdentityProjectionRepository } from "./repositories/prisma/prisma.identity-projection.repository";
export {
  PrismaSsoConnectionBackofficeRepository,
  type PrismaSsoConnectionBackofficeDatabase,
} from "./repositories/prisma/prisma.sso-connection-backoffice.repository";
export type {
  SsoConnectionBackofficePage,
  SsoConnectionBackofficeRepository,
} from "./sso-connection-backoffice.repository";
export {
  PrismaJoinCandidateRepository,
  PrismaJoinRequestReadRepository,
} from "./repositories/prisma/prisma.join-request.repository";
export { PrismaJoinRequestProjectionRepository } from "./repositories/prisma/prisma.join-request-projection.repository";
export { LegacySsoDomainRoutingRepository } from "./repositories/prisma/prisma.legacy-sso-domain-routing.repository";
export { SsoConnectionDomainRoutingRepository } from "./repositories/prisma/prisma.sso-connection-routing.repository";
export {
  JOIN_REJECTION_COOLDOWN_MS,
  JoinRequestsService,
  type JoinMembershipPort,
  type JoinRequestNotifier,
  type JoinRequestsServiceDeps,
  type JoinSettingPort,
} from "./services/join-requests.service";
export {
  LOCAL_METHOD_SET,
  PASSKEY_METHOD,
  PASSWORD_METHOD,
  SignInMethodPolicyService,
  type SignInMethodPolicyInputs,
} from "./services/signin-method-policy.service";
export {
  PrismaIdentityHeadsRepository,
  type PrismaIdentityHeadsDatabase,
} from "./repositories/prisma/prisma.identity-heads.repository";

// The identity graph's remaining application half: the birth entrance, the
// newborn sweep, the write-gate latch, the SCIM sync ledger and projection,
// the operator back office, the teardown dispatcher, the three system
// migrations and the Prisma repositories behind them. All were
// `platform/app/src/server/app-layer/identity/`.
export {
  IdentityBirthService,
  type IdentityBirthServiceDeps,
} from "./services/identity-birth.service";
export {
  IDENTITY_NEWBORN_ABANDONED_AFTER_MS,
  IdentityNewbornReconciliationService,
  type IdentityNewbornReconciliationDeps,
  type IdentityNewbornSweepSummary,
} from "./services/identity-newborn-reconciliation.service";
export {
  IDENTITY_WRITE_GATE_TTL_MS,
  IdentityWriteGateService,
} from "./services/identity-write-gate.service";
export { IdentityWriteGateStatePort } from "./ports/identity-write-gate-state.port";
export {
  SsoConnectionBackofficeService,
  type BackofficeSsoConnection,
  type BackofficeSsoConnectionList,
  type OperatorActor,
} from "./services/sso-connection-backoffice.service";
export {
  MAX_CACHE_ENTRIES,
  perSubjectCachedFlag,
  type PerSubjectCachedFlag,
} from "./per-subject-cached-gate";
export {
  IDENTITY_CONNECTION_GRANDFATHER_MIGRATION_NAME,
  IDENTITY_IDENTIFIER_BACKFILL_MIGRATION_NAME,
} from "./identity-migration-names";
export { IdentitySsoConnectionGrandfatherMigration } from "./migrations/identity-connection-grandfather.migration";
export { IdentityIdentifierBackfillMigration } from "./migrations/identity-identifier-backfill.migration";
export {
  IDENTITY_SECRET_HEAL_MIGRATION_NAME,
  IdentitySecretHealMigration,
} from "./migrations/identity-secret-heal.migration";
export {
  ScimSyncLedgerWriterAdapter,
  type ScimSyncLedgerWriterDeps,
  type ScimSyncStagedSender,
} from "./adapters/eventing.scim-sync-ledger.adapter";
export {
  SsoConnectionTeardownDispatcherAdapter,
  type ConnectionDirectoryRevocation,
} from "./adapters/sso-connection-teardown.adapter";
export { PrismaScimSyncProjectionRepository } from "./repositories/prisma/prisma.scim-sync-projection.repository";
