/**
 * @langwatch/identity-server — the server-side runtime of the identity
 * platform (ADR-101, ADR-115): guards, services and crypto over the app's
 * heads/ledger/records ports. The pure half is `@langwatch/identity-contract`.
 */
export {
  computeIdentifierHash,
  deriveIdentifierId,
  deriveNewbornUserId,
} from "./adapters/crypto.identifier-identity.adapter";
export { s256Challenge } from "./adapters/crypto.pkce.adapter";
export { mintUserHashKey } from "./rules/user-hash-key.rules";
export { IdentityGuards } from "./services/identity-guards.service";
export type {
  BackfillAccountRow,
  BackfillUserRow,
  IdentityBackfillRepository,
} from "./repositories/identity-backfill.repository";
export { type PlannedIdentifier, planIdentifiers } from "./services/identity-backfill-plan.service";
export {
  IDENTITY_BACKFILL_ACTOR,
  type IdentityBackfillOutcome,
  IdentityBackfillService,
  type IdentityBackfillServiceDeps,
} from "./services/identity-backfill.service";
export { IdentityEmailService } from "./services/identity-email.service";
/**
 * The synthetic issuer better-auth 1.7 expects on an account row. Exported
 * from the root, not just `./better-auth`, because it is a PERSISTED format
 * every writer of a credential account row must reach and reuse.
 */
export { issuerForProviderId } from "./adapters/better-auth.account-queries.adapter";
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
} from "./services/identity-secret-carry.service";
export {
  adoptAccountCommandId,
  adoptUserEmailCommandId,
  detachOrphanCommandId,
  establishUserEmailCommandId,
  newIdentityCommandId,
} from "./rules/identity-command-id.rules";
export type {
  IdentityHeadsReader,
  IdentityHeadsRepository,
} from "./repositories/identity-heads.repository";
export type {
  IdentifierReservationHolder,
  IdentityReservationRepository,
} from "./repositories/identity-reservations.repository";
export type { IdentityLedger } from "./rules/identity-ledger.rules";
export type { IdentityUserGate } from "./rules/identity-user-gate.rules";
export type { IdentityUsersRepository } from "./repositories/identity-users.repository";
export type {
  IdentityVerificationRecord,
  IdentityVerificationRepository,
} from "./repositories/identity-verification.repository";
export { IdentityService } from "./services/identity.service";
export type { MfaEnrollmentRepository } from "./repositories/mfa-enrollment.repository";
export { MfaGuards } from "./services/mfa-guards.service";
export {
  type SignInBreakGlassLimiter,
  type SignInDomainRoutingPort,
  type SignInMethodPolicyPort,
  type SignInRouteRequest,
  SignInRouterService,
  type SignInRouterDeps,
  type SignInRoutingRecord,
  type SignInRoutingRecorder,
} from "./services/signin-router.service";
export type {
  IdentityAdoptionWrites,
  IdentityCeremonyWrites,
  IdentityLinkProposalWrites,
  IdentityVerificationWrites,
} from "./rules/identity-writes.rules";
export {
  IdentityJitDisabledError,
  IdentityLinkProposedError,
} from "./services/signin-callback-errors.service";
export {
  type CallbackAssertion,
  type CallbackAuditRecord,
  type CallbackLinkOutcome,
  type CallbackUserMatch,
  type SignInCallbackAudit,
  type SignInCallbackDirectoryPort,
  SignInCallbackLinkingService,
  type SignInCallbackLinkingDeps,
} from "./services/signin-callback-linking.service";
export {
  PostgresJoinRequestNotificationAdapter,
  type JoinRequestNotificationDatabase,
  type PostgresJoinRequestNotificationOptions,
} from "./adapters/postgres.join-request-notification.adapter";
export {
  JoinRequestGuards,
  type JoinRequestGuardsDeps,
} from "./services/join-request-guards.service";
export { JoinRequestAudiencePort } from "./ports/join-request-audience.port";
export { JoinRequestMailPort } from "./ports/join-request-mail.port";
export { JoinRequestNotificationService } from "./services/join-request-notification.service";
export {
  approveJoinCommandId,
  expireJoinCommandId,
  newJoinRequestCommandId,
  newJoinRequestId,
} from "./rules/join-request-id.rules";
export type { JoinRequestLedger } from "./rules/join-request-ledger.rules";
export type {
  JoinCandidateRepository,
  JoinRequestReadRepository,
} from "./repositories/join-request.repository";
export { JoinRequestService } from "./services/join-request.service";
export { SCIM_APPLY_MAX_ATTEMPTS, ScimSyncGuards } from "./services/scim-sync-guards.service";
export { newScimSyncCommandId } from "./rules/scim-sync-id.rules";
export type { ScimSyncLedger } from "./rules/scim-sync-ledger.rules";
export type { ScimSyncReadRepository } from "./repositories/scim-sync.repository";
export {
  type LegacySsoOrganizationRepository,
  type SsoConnectionGrandfatherDeps,
  type SsoConnectionGrandfatherOutcome,
  SsoConnectionGrandfatherService,
} from "./services/sso-connection-grandfather.service";
export { SsoConnectionGuards } from "./services/sso-connection-guards.service";
export type { SsoConnectionGuardsDeps } from "./services/sso-connection-guard-checks.service";
export {
  grandfatherCommandId,
  grandfatheredSsoConnectionId,
  newSsoConnectionCommandId,
  newSsoConnectionId,
} from "./rules/sso-connection-id.rules";
export type { SsoConnectionLedger } from "./rules/sso-connection-ledger.rules";
export {
  ShadowComparingDomainRoutingRepository,
  type SsoConnectionRoutingShadowDeps,
  type SsoConnectionRoutingShadowRecord,
  type SsoConnectionRoutingShadowRecorder,
} from "./adapters/sso-connection-routing-shadow.adapter";
export type {
  SsoBreakGlassBindingRepository,
  SsoConnectionReadRepository,
  SsoConnectionStrandingRepository,
  SsoPlatformOperatorRepository,
} from "./repositories/sso-connection.repository";
export { SsoConnectionService } from "./services/sso-connection.service";
export {
  IDENTITY_VERIFICATION_TTL_MS,
  type MintedEmailVerification,
  VerificationCeremonyService,
  type VerificationCeremonyDeps,
} from "./services/verification-ceremony.service";

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
} from "./adapters/postgres.join-request.adapter";
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
} from "./repositories/sso-connection-backoffice.repository";
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
} from "./services/per-subject-cached-gate.service";
export {
  IDENTITY_CONNECTION_GRANDFATHER_MIGRATION_NAME,
  IDENTITY_IDENTIFIER_BACKFILL_MIGRATION_NAME,
} from "./rules/identity-migration-names.rules";
export { IdentitySsoConnectionGrandfatherMigration } from "./adapters/system-migration.identity-connection-grandfather.adapter";
export { IdentityIdentifierBackfillMigration } from "./adapters/system-migration.identity-identifier-backfill.adapter";
export {
  IDENTITY_SECRET_HEAL_MIGRATION_NAME,
  IdentitySecretHealMigration,
} from "./adapters/system-migration.identity-secret-heal.adapter";
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
