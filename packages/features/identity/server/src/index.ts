/**
 * @langwatch/identity-server — the server-side runtime of the identity
 * platform (ADR-101, ADR-115): guards, services and crypto over the app's
 * heads/ledger/records ports. The pure half is `@langwatch/identity-contract`.
 */
export { CryptoIdentifierIdentityAdapter } from "./adapters/crypto.identifier-identity.adapter.ts";
export {
  type DeriveIdentifierIdInput,
  IdentifierIdentityPort,
} from "./ports/identifier-identity.port.ts";
export { computeIdentifierHash, deriveNewbornUserId } from "./rules/identifier-hash.rules.ts";
export { s256Challenge } from "./rules/pkce.rules.ts";
export { mintUserHashKey } from "./rules/user-hash-key.rules.ts";
export { IdentityGuardsService } from "./services/identity-guards.service.ts";
export type {
  BackfillAccountRow,
  BackfillUserRow,
  IdentityBackfillRepository,
} from "./repositories/identity-backfill.repository.ts";
export {
  IdentityBackfillPlanService,
  type PlannedIdentifier,
} from "./services/identity-backfill-plan.service.ts";
export {
  IDENTITY_BACKFILL_ACTOR,
  type IdentityBackfillOutcome,
  IdentityBackfillService,
  type IdentityBackfillServiceDeps,
} from "./services/identity-backfill.service.ts";
export { IdentityEmailService } from "./services/identity-email.service.ts";
/**
 * The synthetic issuer better-auth 1.7 expects on an account row. Exported
 * from the root, not just `./better-auth`, because it is a PERSISTED format
 * every writer of a credential account row must reach and reuse.
 */
export { BetterAuthAccountQueriesAdapter } from "./adapters/better-auth.account-queries.adapter.ts";
/**
 * The row mappings the fold writes through and every guard reads back through.
 * The identity platform's event-sourcing layer (ADR-101, ADR-115, ADR-116,
 * ADR-117), folded into this package in the core-application exit: the
 */
export { IdentityProducerPipelinesAdapter } from "./adapters/producer.identity-pipelines.adapter.ts";
export {
  type IdentityPipelineDatabase,
  PostgresIdentityPipelineAdapter,
  type PostgresIdentityPipelineOptions,
} from "./adapters/postgres.identity-pipeline.adapter.ts";
export {
  PostgresJoinRequestPipelineAdapter,
  type JoinRequestPipelineDatabase,
  type PostgresJoinRequestPipelineOptions,
} from "./adapters/postgres.join-request-pipeline.adapter.ts";
export {
  PostgresScimSyncPipelineAdapter,
  type PostgresScimSyncPipelineOptions,
  type ScimSyncPipelineDatabase,
} from "./adapters/postgres.scim-sync-pipeline.adapter.ts";
export {
  PostgresSsoConnectionPipelineAdapter,
  type PostgresSsoConnectionPipelineOptions,
  type SsoConnectionPipelineDatabase,
} from "./adapters/postgres.sso-connection-pipeline.adapter.ts";
export type { IdentityPipeline } from "./adapters/identity-pipeline-definition.adapter.ts";
export type { JoinRequestPipeline } from "./adapters/join-request-pipeline-definition.adapter.ts";
export type { ScimSyncPipeline } from "./adapters/scim-sync-pipeline-definition.adapter.ts";
/** The day-7-reminder/day-14-expiry process manager's registered name, named
 *  by a caller that asserts on which process a wake dispatched through. */
export { JOIN_REQUEST_LIFECYCLE_PROCESS_NAME } from "./processes/join-request-lifecycle.process.ts";
export {
  type IdentityGuardsComposition,
  type IdentityGuardsDatabase,
  PostgresIdentityGuardsAdapter,
  type PostgresIdentityGuardsOptions,
} from "./adapters/postgres.identity-guards.adapter.ts";
export {
  PostgresIdentityNewbornSweepAdapter,
  type PostgresIdentityNewbornSweepOptions,
} from "./adapters/postgres.identity-newborn-sweep.adapter.ts";
export {
  IDENTITY_LATCH_CACHE_MAX_USERS,
  IDENTITY_LATCH_CACHE_TTL_MS,
  PostgresIdentityEmailAdapter,
  type PostgresIdentityEmailAdapterOptions,
} from "./adapters/postgres.identity-email.adapter.ts";
export {
  type AccountSecretPair,
  IdentitySecretCarryService,
  type IdentitySecretCarryOutcome,
  type IdentitySecretCarryRepository,
} from "./services/identity-secret-carry.service.ts";
export {
  adoptAccountCommandId,
  adoptUserEmailCommandId,
  detachOrphanCommandId,
  establishUserEmailCommandId,
  newIdentityCommandId,
} from "./rules/identity-command-id.rules.ts";
export type {
  IdentityHeadsReader,
  IdentityHeadsRepository,
} from "./repositories/identity-heads.repository.ts";
export type {
  IdentifierReservationHolder,
  IdentityReservationRepository,
} from "./repositories/identity-reservations.repository.ts";
export type { IdentityLedger } from "./rules/identity-ledger.rules.ts";
export type { IdentityUserGate } from "./rules/identity-user-gate.rules.ts";
export type { IdentityUsersRepository } from "./repositories/identity-users.repository.ts";
export type {
  IdentityVerificationRecord,
  IdentityVerificationRepository,
} from "./repositories/identity-verification.repository.ts";
export { IdentityService } from "./services/identity.service.ts";
export type { MfaEnrollmentRepository } from "./repositories/mfa-enrollment.repository.ts";
export { MfaGuardsService } from "./services/mfa-guards.service.ts";
export {
  type SignInBreakGlassLimiter,
  type SignInDomainRoutingPort,
  type SignInMethodPolicyPort,
  type SignInRouteRequest,
  SignInRouterService,
  type SignInRouterDeps,
  type SignInRoutingRecord,
  type SignInRoutingRecorder,
} from "./services/signin-router.service.ts";
export type {
  IdentityAdoptionWrites,
  IdentityCeremonyWrites,
  IdentityLinkProposalWrites,
  IdentityVerificationWrites,
} from "./rules/identity-writes.rules.ts";
export { IdentityJitDisabledError, IdentityLinkProposedError } from "@langwatch/identity-contract";
export {
  type CallbackAssertion,
  type CallbackAuditRecord,
  type CallbackLinkOutcome,
  type CallbackUserMatch,
  type SignInCallbackAudit,
  type SignInCallbackDirectoryPort,
  SignInCallbackLinkingService,
  type SignInCallbackLinkingDeps,
} from "./services/signin-callback-linking.service.ts";
export {
  PostgresJoinRequestNotificationAdapter,
  type JoinRequestNotificationDatabase,
  type PostgresJoinRequestNotificationOptions,
} from "./adapters/postgres.join-request-notification.adapter.ts";
export {
  JoinRequestGuardsService,
  type JoinRequestGuardsDeps,
} from "./services/join-request-guards.service.ts";
export { JoinRequestAudiencePort } from "./ports/join-request-audience.port.ts";
export { JoinRequestMailPort } from "./ports/join-request-mail.port.ts";
export { JoinRequestNotificationService } from "./services/join-request-notification.service.ts";
export {
  approveJoinCommandId,
  expireJoinCommandId,
  newJoinRequestCommandId,
  newJoinRequestId,
} from "./rules/join-request-id.rules.ts";
export type { JoinRequestLedger } from "./rules/join-request-ledger.rules.ts";
export type {
  JoinCandidateRepository,
  JoinRequestReadRepository,
} from "./repositories/join-request.repository.ts";
export { JoinRequestService } from "./services/join-request.service.ts";
export {
  SCIM_APPLY_MAX_ATTEMPTS,
  ScimSyncGuardsService,
} from "./services/scim-sync-guards.service.ts";
export { newScimSyncCommandId } from "./rules/scim-sync-id.rules.ts";
export type { ScimSyncLedger } from "./rules/scim-sync-ledger.rules.ts";
export type { ScimSyncReadRepository } from "./repositories/scim-sync.repository.ts";
export {
  type LegacySsoOrganizationRepository,
  type SsoConnectionGrandfatherDeps,
  type SsoConnectionGrandfatherOutcome,
  SsoConnectionGrandfatherService,
} from "./services/sso-connection-grandfather.service.ts";
export { SsoConnectionGuardsService } from "./services/sso-connection-guards.service.ts";
export type { SsoConnectionGuardsDeps } from "./services/sso-connection-guard-checks.service.ts";
export {
  grandfatherCommandId,
  grandfatheredSsoConnectionId,
  newSsoConnectionCommandId,
  newSsoConnectionId,
} from "./rules/sso-connection-id.rules.ts";
export type { SsoConnectionLedger } from "./rules/sso-connection-ledger.rules.ts";
export {
  ShadowComparingDomainRoutingAdapter,
  type SsoConnectionRoutingShadowDeps,
  type SsoConnectionRoutingShadowRecord,
  type SsoConnectionRoutingShadowRecorder,
} from "./adapters/sso-connection-routing-shadow.adapter.ts";
export type {
  SsoBreakGlassBindingRepository,
  SsoConnectionReadRepository,
  SsoConnectionStrandingRepository,
  SsoPlatformOperatorRepository,
} from "./repositories/sso-connection.repository.ts";
export { SsoConnectionService } from "./services/sso-connection.service.ts";
export {
  IDENTITY_VERIFICATION_TTL_MS,
  type MintedEmailVerification,
  VerificationCeremonyService,
  type VerificationCeremonyDeps,
} from "./services/verification-ceremony.service.ts";

// --------------------------------------------------------------------------- The composition half
// the platform application used to own Every module below was `platform/app/src/server/app-
// layer/identity/`: the Postgres repositories the guards and the fold read and write through, the
// two ledger writers, the join-request orchestration around the event-sourced lifecycle, and the
// instance's sign-in method policy.
export { IdentityEventingPort } from "./ports/identity-eventing.port.ts";
export { PlatformOperatorPort } from "./ports/platform-operator.port.ts";
export {
  IDENTITY_CONVERGENCE_POLL_MS,
  IDENTITY_CONVERGENCE_TIMEOUT_MS,
  IdentityLedgerWriterAdapter,
  type IdentityLedgerWriterDeps,
  type IdentityStagedSender,
} from "./adapters/identity-ledger.adapter.ts";
export {
  JOIN_REQUEST_CONVERGENCE_POLL_MS,
  JOIN_REQUEST_CONVERGENCE_TIMEOUT_MS,
  JoinRequestLedgerWriterAdapter,
  type JoinRequestLedgerWriterDeps,
  type JoinRequestStagedSender,
} from "./adapters/join-request-ledger.adapter.ts";
export {
  EmailJoinRequestNotifierAdapter,
  JoinRequestLifecycleDispatcherAdapter,
  PrismaJoinMembershipAdapter,
  PrismaJoinSettingsAdapter,
} from "./adapters/postgres.join-request.adapter.ts";
export { JoinRequestNotificationMailPort } from "./ports/join-request-notification-mail.port.ts";
export { InProcessBreakGlassLimiterAdapter } from "./adapters/in-process-break-glass-limiter.adapter.ts";
export { LocalDoorBreakGlassBindingAdapter } from "./adapters/local-door-break-glass-binding.adapter.ts";
export { PrismaIdentityVerificationRepository } from "./repositories/prisma/prisma.identity-verification.repository.ts";
export { PrismaIdentityProjectionRepository } from "./repositories/prisma/prisma.identity-projection.repository.ts";
export type {
  SsoConnectionBackofficePage,
  SsoConnectionBackofficeRepository,
} from "./repositories/sso-connection-backoffice.repository.ts";
export {
  PrismaJoinCandidateRepository,
  PrismaJoinRequestReadRepository,
} from "./repositories/prisma/prisma.join-request.repository.ts";
export { PrismaJoinRequestProjectionRepository } from "./repositories/prisma/prisma.join-request-projection.repository.ts";
export { LegacySsoDomainRoutingRepository } from "./repositories/prisma/prisma.legacy-sso-domain-routing.repository.ts";
export { SsoConnectionDomainRoutingRepository } from "./repositories/prisma/prisma.sso-connection-routing.repository.ts";
export {
  JOIN_REJECTION_COOLDOWN_MS,
  JoinRequestsService,
  type JoinMembershipPort,
  type JoinRequestNotifier,
  type JoinRequestsServiceDeps,
  type JoinSettingPort,
} from "./services/join-requests.service.ts";
export {
  LOCAL_METHOD_SET,
  PASSKEY_METHOD,
  PASSWORD_METHOD,
  SignInMethodPolicyService,
  type SignInMethodPolicyInputs,
} from "./services/signin-method-policy.service.ts";
export {
  PrismaIdentityHeadsRepository,
  type PrismaIdentityHeadsDatabase,
} from "./repositories/prisma/prisma.identity-heads.repository.ts";

// The identity graph's remaining application half: the birth entrance, the
// newborn sweep, the write-gate latch, the SCIM sync ledger and projection,
// the operator back office, the teardown dispatcher, the three system
// migrations and the Prisma repositories behind them. All were
// `platform/app/src/server/app-layer/identity/`.
export {
  IdentityBirthService,
  type IdentityBirthServiceDeps,
} from "./services/identity-birth.service.ts";
export {
  IDENTITY_NEWBORN_ABANDONED_AFTER_MS,
  IdentityNewbornReconciliationService,
  type IdentityNewbornReconciliationDeps,
  type IdentityNewbornSweepSummary,
} from "./services/identity-newborn-reconciliation.service.ts";
export {
  IDENTITY_WRITE_GATE_TTL_MS,
  IdentityWriteGateService,
} from "./services/identity-write-gate.service.ts";
export { IdentityWriteGateStatePort } from "./ports/identity-write-gate-state.port.ts";
export {
  SsoConnectionBackofficeService,
  type BackofficeSsoConnection,
  type BackofficeSsoConnectionList,
  type OperatorActor,
} from "./services/sso-connection-backoffice.service.ts";
export {
  MAX_CACHE_ENTRIES,
  PerSubjectCachedGateService,
  type PerSubjectCachedFlag,
} from "./services/per-subject-cached-gate.service.ts";
export {
  IDENTITY_CONNECTION_GRANDFATHER_MIGRATION_NAME,
  IDENTITY_IDENTIFIER_BACKFILL_MIGRATION_NAME,
} from "./rules/identity-migration-names.rules.ts";
export { IdentitySsoConnectionGrandfatherMigrationAdapter } from "./adapters/system-migration.identity-connection-grandfather.adapter.ts";
export { IdentityIdentifierBackfillMigrationAdapter } from "./adapters/system-migration.identity-identifier-backfill.adapter.ts";
export {
  IDENTITY_SECRET_HEAL_MIGRATION_NAME,
  IdentitySecretHealMigrationAdapter,
} from "./adapters/system-migration.identity-secret-heal.adapter.ts";
export {
  PostgresIdentityUserMigrationsAdapter,
  type PostgresIdentityUserMigrationsOptions,
} from "./adapters/postgres.identity-user-migrations.adapter.ts";
export {
  ScimSyncLedgerWriterAdapter,
  type ScimSyncLedgerWriterDeps,
  type ScimSyncStagedSender,
} from "./adapters/eventing.scim-sync-ledger.adapter.ts";
export {
  SsoConnectionTeardownDispatcherAdapter,
  type ConnectionDirectoryRevocation,
} from "./adapters/sso-connection-teardown.adapter.ts";
export { PrismaScimSyncProjectionRepository } from "./repositories/prisma/prisma.scim-sync-projection.repository.ts";
