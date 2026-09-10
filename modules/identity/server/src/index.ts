/**
 * @langwatch/identity-server — the server-side runtime of the identity
 * platform (ADR-101, ADR-115): guards, services and crypto over the app's
 * heads/ledger/records ports. The pure half is `@langwatch/identity-contract`.
 */
export { identityServer } from "./identity.server.ts";
export { IdentityApp } from "./app/identity.app.ts";
export type { IdentityInfrastructure } from "./app/identity-members.ts";
export { PrismaIdentityReservationRepository } from "./repositories/prisma/prisma.identity-reservations.repository.ts";
export { PrismaIdentitySecretCarryRepository } from "./repositories/prisma/prisma.identity-secret-carry.repository.ts";
export { PrismaJoinRequestAudienceRepository } from "./repositories/prisma/prisma.join-request-audience.repository.ts";
export { AdminEmailPlatformOperatorsRepository } from "./repositories/prisma/prisma.sso-platform-operators.repository.ts";
export { SsoConnectionLedgerWriterAdapter } from "./services/eventing-sso-connection-ledger.service.ts";
export { PrismaSsoConnectionProjectionRepository } from "./repositories/prisma/prisma.sso-connection-projection.repository.ts";
export type { SsoConnectionEvent } from "./projections/sso-connection-state.projection.ts";
export { CryptoIdentifierIdentityAdapter } from "./services/crypto-identifier-identity.service.ts";
export {
  type DeriveIdentifierIdInput,
  type IdentifierIdentity,
} from "./app/identity.members.ts";
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
export { BetterAuthAccountQueriesAdapter } from "./services/better-auth-account-queries.service.ts";
/**
 * The row mappings the fold writes through and every guard reads back through.
 * The identity platform's event-sourcing layer (ADR-101, ADR-115, ADR-116,
 * ADR-117), folded into this package in the core-application exit: the
 */
export { IdentityProducerPipelinesAdapter } from "./services/producer-identity-pipelines.service.ts";
export {
  type IdentityPipelineDatabase,
  PostgresIdentityPipelineAdapter,
  type PostgresIdentityPipelineOptions,
} from "./repositories/prisma/prisma.identity-pipeline.repository.ts";
export {
  PostgresJoinRequestPipelineAdapter,
  type JoinRequestPipelineDatabase,
  type PostgresJoinRequestPipelineOptions,
} from "./repositories/prisma/prisma.join-request-pipeline.repository.ts";
export {
  PostgresScimSyncPipelineAdapter,
  type PostgresScimSyncPipelineOptions,
  type ScimSyncPipelineDatabase,
} from "./repositories/prisma/prisma.scim-sync-pipeline.repository.ts";
export {
  PostgresSsoConnectionPipelineAdapter,
  type PostgresSsoConnectionPipelineOptions,
} from "./repositories/prisma/prisma.sso-connection-pipeline.repository.ts";
export type { IdentityPipeline } from "./services/identity-pipeline-definition.service.ts";
export type { JoinRequestPipeline } from "./services/join-request-pipeline-definition.service.ts";
export type { ScimSyncPipeline } from "./services/scim-sync-pipeline-definition.service.ts";
/** The day-7-reminder/day-14-expiry process manager's registered name, named
 *  by a caller that asserts on which process a wake dispatched through. */
export { JOIN_REQUEST_LIFECYCLE_PROCESS_NAME } from "./processes/join-request-lifecycle.process.ts";
export {
  type IdentityGuardsComposition,
  type IdentityGuardsDatabase,
  PostgresIdentityGuardsAdapter,
  type PostgresIdentityGuardsOptions,
} from "./repositories/prisma/prisma.identity-guards.repository.ts";
export {
  PostgresIdentityNewbornSweepAdapter,
  type PostgresIdentityNewbornSweepOptions,
} from "./repositories/prisma/prisma.identity-newborn-sweep.repository.ts";
export {
  IDENTITY_LATCH_CACHE_MAX_USERS,
  IDENTITY_LATCH_CACHE_TTL_MS,
  PostgresIdentityEmailAdapter,
  type PostgresIdentityEmailAdapterOptions,
} from "./repositories/prisma/prisma.identity-email.repository.ts";
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
export { IdentityLatchRepository } from "./repositories/identity-latch.repository.ts";
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
  type SignInDomainRouting,
  type SignInMethodPolicyResolver,
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
  type SignInCallbackDirectory,
  SignInCallbackLinkingService,
  type SignInCallbackLinkingDeps,
} from "./services/signin-callback-linking.service.ts";
export {
  PostgresJoinRequestNotificationAdapter,
  type JoinRequestNotificationDatabase,
  type PostgresJoinRequestNotificationOptions,
} from "./repositories/prisma/prisma.join-request-notification.repository.ts";
export {
  JoinRequestGuardsService,
  type JoinRequestGuardsDeps,
} from "./services/join-request-guards.service.ts";
export { type JoinRequestAudience } from "./repositories/join-request-audience.repository.ts";
export { type JoinRequestMail } from "./app/identity.members.ts";
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
} from "./services/sso-connection-routing-shadow.service.ts";
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
export { type IdentityEventing } from "./app/identity.members.ts";
export { type PlatformOperator } from "./app/identity.members.ts";
export {
  IDENTITY_CONVERGENCE_POLL_MS,
  IDENTITY_CONVERGENCE_TIMEOUT_MS,
  IdentityLedgerWriterAdapter,
  type IdentityLedgerWriterDeps,
  type IdentityStagedSender,
} from "./services/identity-ledger.service.ts";
export {
  JOIN_REQUEST_CONVERGENCE_POLL_MS,
  JOIN_REQUEST_CONVERGENCE_TIMEOUT_MS,
  JoinRequestLedgerWriterAdapter,
  type JoinRequestLedgerWriterDeps,
  type JoinRequestStagedSender,
} from "./services/join-request-ledger.service.ts";
export { EmailJoinRequestNotifierAdapter } from "./services/join-request-notifier.service.ts";
export { JoinRequestLifecycleDispatcherAdapter } from "./services/join-request-lifecycle-dispatcher.service.ts";
export { type JoinRequestNotificationMail } from "./app/identity.members.ts";
export { InProcessBreakGlassLimiterAdapter } from "./services/in-process-break-glass-limiter.service.ts";
export { LocalDoorBreakGlassBindingAdapter } from "./services/local-door-break-glass-binding.service.ts";
export { PrismaIdentityVerificationRepository } from "./repositories/prisma/prisma.identity-verification.repository.ts";
export { PrismaIdentityProjectionRepository } from "./repositories/prisma/prisma.identity-projection.repository.ts";
export type {
  SsoConnectionBackofficePage,
  SsoConnectionBackofficeRepository,
} from "./repositories/sso-connection-backoffice.repository.ts";
export {
  PrismaSsoConnectionBackofficeRepository,
  type PrismaSsoConnectionBackofficeDatabase,
} from "./repositories/prisma/prisma.sso-connection-backoffice.repository.ts";
export {
  PrismaJoinCandidateRepository,
  PrismaJoinRequestReadRepository,
} from "./repositories/prisma/prisma.join-request.repository.ts";
export { PrismaJoinRequestProjectionRepository } from "./repositories/prisma/prisma.join-request-projection.repository.ts";
export { LegacySsoDomainRoutingRepository } from "./repositories/prisma/prisma.legacy-sso-domain-routing.repository.ts";
export { SsoConnectionDomainRoutingRepository } from "./repositories/prisma/prisma.sso-connection-routing.repository.ts";
export { JoinRequestsService } from "./services/join-requests.service.ts";
export {
  JOIN_REJECTION_COOLDOWN_MS,
  type JoinMembership,
  type JoinRequestNotifier,
  type JoinRequestsServiceDeps,
  type JoinSetting,
} from "./rules/join-requests-contract.rules.ts";
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
export { type IdentityWriteGateState } from "./app/identity.members.ts";

// better-auth's `database:` entry and its two account ceremonies (ADR-116 §1,
// §5). Exported because the process that mounts better-auth composes them; a
// deployment that reaches neither runs the stock storage engine and no
// ceremonies, which is what it did before they were written.
export {
  BetterAuthCeremonyBridgeAdapter,
  IdentityCeremoniesAdapter,
} from "./services/better-auth-identity-ceremonies.service.ts";
export {
  BetterAuthIdentityStorageAdapter,
  type IdentityStorageAdapterDeps,
} from "./services/better-auth-identity-storage.service.ts";
export { PrismaIdentityAccountsRepository } from "./repositories/prisma/prisma.identity-accounts.repository.ts";
export { PrismaIdentityNewbornRepository } from "./repositories/prisma/prisma.identity-newborn.repository.ts";
export { PrismaIdentityResolutionRepository } from "./repositories/prisma/prisma.identity-resolution.repository.ts";
export {
  PrismaIdentityUsersRepository,
  type PrismaIdentityUsersDatabase,
} from "./repositories/prisma/prisma.identity-users.repository.ts";
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
export { IdentitySsoConnectionGrandfatherMigrationAdapter } from "./services/system-migration-identity-connection-grandfather.service.ts";
export { IdentityIdentifierBackfillMigrationAdapter } from "./services/system-migration-identity-identifier-backfill.service.ts";
export {
  IDENTITY_SECRET_HEAL_MIGRATION_NAME,
  IdentitySecretHealMigrationAdapter,
} from "./services/system-migration-identity-secret-heal.service.ts";
export {
  PostgresIdentityUserMigrationsAdapter,
  type PostgresIdentityUserMigrationsOptions,
} from "./repositories/prisma/prisma.identity-user-migrations.repository.ts";
export {
  ScimSyncLedgerWriterAdapter,
  type ScimSyncLedgerWriterDeps,
  type ScimSyncStagedSender,
} from "./services/eventing-scim-sync-ledger.service.ts";
export {
  SsoConnectionTeardownDispatcherAdapter,
  type ConnectionDirectoryRevocation,
} from "./services/sso-connection-teardown.service.ts";
export { PrismaScimSyncProjectionRepository } from "./repositories/prisma/prisma.scim-sync-projection.repository.ts";
export { identityRepositories } from "./repositories/identity-repositories.registry.ts";
export type { IdentityRepositories } from "./repositories/identity.repositories.ts";
export { MemoryIdentityStore } from "./repositories/memory/memory-identity.store.ts";
export { MemoryIdentityRepositories } from "./repositories/memory/memory.identity.repositories.ts";
export { PostgresIdentityRepositories } from "./repositories/prisma/prisma.identity.repositories.ts";
export { PrismaJoinMembershipRepository } from "./repositories/prisma/prisma.join-membership.repository.ts";
export { PrismaJoinSettingRepository } from "./repositories/prisma/prisma.join-setting.repository.ts";
