/**
 * @langwatch/identity-process — the server-side runtime of the identity
 * platform (ADR-101, ADR-115): guards, services and crypto over the app's
 * heads/ledger/records ports. The pure half is `@langwatch/identity-contract`.
 */
export { identityServer } from "./identity.server.ts";
export type { IdentityInfrastructure } from "./app/identity-members.ts";
export { SsoConnectionLedgerWriterAdapter } from "./services/eventing-sso-connection-ledger.service.ts";
export type { SsoConnectionEvent } from "./eventing/sso-connection-state.projection.ts";
export { CryptoIdentifierIdentityAdapter } from "./services/crypto-identifier-identity.service.ts";
export { type DeriveIdentifierIdInput, type IdentifierIdentity } from "./app/identity.members.ts";
export type {
  BackfillAccountRow,
  BackfillUserRow,
} from "./repositories/identity-backfill.repository.ts";
export type { PlannedIdentifier } from "./services/identity-backfill-plan.service.ts";
export type {
  IdentityBackfillOutcome,
  IdentityBackfillServiceDeps,
} from "./services/identity-backfill.service.ts";
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
export { JOIN_REQUEST_LIFECYCLE_PROCESS_NAME } from "./eventing/join-request-lifecycle.process.ts";
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
export type { PostgresIdentityEmailAdapterOptions } from "./repositories/prisma/prisma.identity-email.repository.ts";
export type {
  AccountSecretPair,
  IdentitySecretCarryOutcome,
} from "./services/identity-secret-carry.service.ts";
export type { IdentityHeadsReader } from "./repositories/identity-heads.repository.ts";
export type { IdentifierReservationHolder } from "./repositories/identity-reservations.repository.ts";
export type { IdentityLedger } from "./rules/identity-ledger.rules.ts";
export type { IdentityUserGate } from "./rules/identity-user-gate.rules.ts";
export type { IdentityUsersRepository } from "./repositories/identity-users.repository.ts";
export type { IdentityVerificationRecord } from "./repositories/identity-verification.repository.ts";
export type { MfaEnrollmentRepository } from "./repositories/mfa-enrollment.repository.ts";
export {
  SsoBreakGlassRepository,
  SsoBreakGlassWarningChannel,
} from "./repositories/sso-break-glass.repository.ts";
export { breakGlassHolderEligibility } from "./rules/break-glass-eligibility.rules.ts";
export {
  RequiresLocalDoorAndBinding,
  SsoBreakGlassService,
  type SsoBreakGlassServiceDeps,
} from "./services/sso-break-glass.service.ts";
export type {
  IdentitySignInAccountsRepository,
  LegacySignInAccount,
} from "./repositories/identity-signin-accounts.repository.ts";
export {
  SignInAccountLookupService,
  type SignInAccountLookupServiceDeps,
} from "./services/signin-account-lookup.service.ts";
export type {
  SignInAccountLookup,
  SignInBreakGlassLimiter,
  SignInDomainRouting,
  SignInRouteRequest,
  SignInRouterDeps,
  SignInRoutingRecord,
  SignInRoutingRecorder,
} from "./services/signin-router.service.ts";
export type {
  IdentityAdoptionWrites,
  IdentityCeremonyWrites,
  IdentityLinkProposalWrites,
  IdentityVerificationWrites,
} from "./rules/identity-writes.rules.ts";
export { IdentityJitDisabledError, IdentityLinkProposedError } from "@langwatch/identity-contract";
export type {
  CallbackAssertion,
  CallbackAuditRecord,
  CallbackLinkOutcome,
  CallbackUserMatch,
  SignInCallbackAudit,
  SignInCallbackDirectory,
  SignInCallbackLinkingDeps,
} from "./services/signin-callback-linking.service.ts";
export {
  PostgresJoinRequestNotificationAdapter,
  type JoinRequestNotificationDatabase,
  type PostgresJoinRequestNotificationOptions,
} from "./repositories/prisma/prisma.join-request-notification.repository.ts";
export type { JoinRequestGuardsDeps } from "./services/join-request-guards.service.ts";
export type { JoinRequestAudience } from "./repositories/join-request-audience.repository.ts";
export { type JoinRequestMail } from "./app/identity.members.ts";
export type { JoinRequestLedger } from "./rules/join-request-ledger.rules.ts";
export type { ScimSyncLedger } from "./rules/scim-sync-ledger.rules.ts";
export type { ScimSyncReadRepository } from "./repositories/scim-sync.repository.ts";
export type {
  SsoConnectionGrandfatherDeps,
  SsoConnectionGrandfatherOutcome,
} from "./services/sso-connection-grandfather.service.ts";
export type { SsoConnectionGuardsDeps } from "./services/sso-connection-guard-checks.service.ts";
export type { SsoConnectionLedger } from "./rules/sso-connection-ledger.rules.ts";
export {
  ShadowComparingDomainRoutingAdapter,
  type SsoConnectionRoutingShadowDeps,
  type SsoConnectionRoutingShadowRecord,
  type SsoConnectionRoutingShadowRecorder,
} from "./services/sso-connection-routing-shadow.service.ts";
export type {
  MintedEmailVerification,
  VerificationCeremonyDeps,
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
export { type JoinRequestNotificationMail } from "./app/identity.members.ts";
export { InProcessBreakGlassLimiterAdapter } from "./services/in-process-break-glass-limiter.service.ts";
export { LocalDoorBreakGlassBindingAdapter } from "./services/local-door-break-glass-binding.service.ts";
export type { SsoConnectionBackofficePage } from "./repositories/sso-connection-backoffice.repository.ts";
export type { PrismaSsoConnectionBackofficeDatabase } from "./repositories/prisma/prisma.sso-connection-backoffice.repository.ts";
export { PrismaLegacySsoOrganizationRepository } from "./repositories/prisma/prisma.legacy-sso-organization.repository.ts";
export type {
  JoinMembership,
  JoinRequestNotifier,
  JoinRequestsServiceDeps,
  JoinSetting,
} from "./rules/join-requests-contract.rules.ts";
export type { PrismaIdentityHeadsDatabase } from "./repositories/prisma/prisma.identity-heads.repository.ts";

// The identity graph's remaining application half: the birth entrance, the
// newborn sweep, the write-gate latch, the SCIM sync ledger and projection,
// the operator back office, the teardown dispatcher, the three system
// migrations and the Prisma repositories behind them. All were
// `platform/app/src/server/app-layer/identity/`.
export type { IdentityBirthServiceDeps } from "./services/identity-birth.service.ts";
export type {
  IdentityNewbornReconciliationDeps,
  IdentityNewbornSweepSummary,
} from "./services/identity-newborn-reconciliation.service.ts";
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
export type { PrismaIdentityUsersDatabase } from "./repositories/prisma/prisma.identity-users.repository.ts";
export type {
  BackofficeSsoConnection,
  BackofficeSsoConnectionList,
  OperatorActor,
} from "./services/sso-connection-backoffice.service.ts";
export type { PerSubjectCachedFlag } from "./services/per-subject-cached-gate.service.ts";
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
export type { IdentityRepositories } from "./repositories/identity.repositories.ts";
export {
  BetterAuthIdentityBirthAdapter,
  type IdentityBirthScope,
} from "./services/better-auth-identity-birth.service.ts";
