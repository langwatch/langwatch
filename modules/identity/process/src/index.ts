/**
 * @langwatch/identity-process — the server-side runtime of the identity
 * platform (ADR-101, ADR-115): guards, services and crypto over the app's
 * heads/ledger/records ports. The pure half is `@langwatch/identity-contract`.
 */
export { identityServer } from "./identity.server.ts";
export type { IdentityInfrastructure } from "./app/identity.members.ts";
export { SsoConnectionLedgerStore } from "./eventing/sso-connection-ledger.store.ts";
export type { SsoConnectionEvent } from "./eventing/sso-connection-state.projection.ts";
export { CryptoIdentifierIdentityService } from "./services/crypto-identifier-identity.service.ts";
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
export {
  issuerForProviderId,
  parseAccountQuery,
  providerIdFromIssuer,
} from "./rules/better-auth-account-queries.rules.ts";
/**
 * The row mappings the fold writes through and every guard reads back through.
 * The identity platform's event-sourcing layer (ADR-101, ADR-115, ADR-116,
 * ADR-117), folded into this package in the core-application exit: the
 */
export type { IdentityPipeline } from "./eventing/user-identity.pipeline.ts";
export type { JoinRequestPipeline } from "./eventing/join-request.pipeline.ts";
export type { ScimSyncPipeline } from "./eventing/scim-sync.pipeline.ts";
/** The day-7-reminder/day-14-expiry process manager's registered name, named
 *  by a caller that asserts on which process a wake dispatched through. */
export { JOIN_REQUEST_LIFECYCLE_PROCESS_NAME } from "./eventing/join-request-lifecycle.process.ts";
/** The domain-proof notification process manager's registered name, and the
 *  seam a composition answers it with (ADR-123). */
export {
  SSO_DOMAIN_PROOF_NOTIFICATION_PROCESS_NAME,
  type SsoDomainProofNotifications,
} from "./eventing/sso-domain-proof-notification.process.ts";
export {
  SsoDomainProofNotificationService,
  UnaddressedSsoDomainProofNotifications,
  type SsoDomainProofAudience,
} from "./services/sso-domain-proof-notification.service.ts";
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
export { SsoBreakGlassWarningChannel } from "./channels/sso-break-glass-warning.channel.ts";
export { SsoBreakGlassRepository } from "./repositories/sso-break-glass.repository.ts";
export { breakGlassHolderEligibility } from "./rules/break-glass-eligibility.rules.ts";
export {
  SsoConnectionHistoryRepository,
  type SsoConnectionHistoryEntry,
} from "./repositories/sso-connection-history.repository.ts";
export { EventingSsoConnectionHistoryRepository } from "./repositories/eventing/eventing.sso-connection-history.repository.ts";
export { ssoConnectionHistoryCopy } from "./rules/sso-connection-history-copy.rules.ts";
export { SsoConnectionHistoryService } from "./services/sso-connection-history.service.ts";
export { OrganizationSsoConnectionsService } from "./services/organization-sso-connections.service.ts";
export { ScimSyncReadsService } from "./services/scim-sync-reads.service.ts";
export { SsoIssuerDirectoryService } from "./services/sso-issuer-directory.service.ts";
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
export type { JoinRequestGuardsDeps } from "./services/join-request-guards.service.ts";
export type { JoinRequestAudienceRepository } from "./repositories/join-request-audience.repository.ts";
export { type JoinRequestMail, type SsoDomainProofMail } from "./app/identity.members.ts";
export type { JoinRequestLedger } from "./rules/join-request-ledger.rules.ts";
export type { ScimSyncLedger } from "./rules/scim-sync-ledger.rules.ts";
export type { ScimSyncReadRepository } from "./repositories/scim-sync.repository.ts";
export type {
  SsoConnectionGrandfatherDeps,
  SsoConnectionGrandfatherOutcome,
} from "./services/sso-connection-grandfather.service.ts";
export type { SsoConnectionGuardsDeps } from "./services/sso-connection-guard-checks.service.ts";
export type { SsoConnectionLedger } from "./rules/sso-connection-ledger.rules.ts";
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
  IdentityLedgerStore,
  type IdentityLedgerWriterDeps,
  type IdentityStagedSender,
} from "./eventing/identity-ledger.store.ts";
export {
  JOIN_REQUEST_CONVERGENCE_POLL_MS,
  JOIN_REQUEST_CONVERGENCE_TIMEOUT_MS,
  JoinRequestLedgerStore,
  type JoinRequestLedgerWriterDeps,
  type JoinRequestStagedSender,
} from "./eventing/join-request-ledger.store.ts";
export { type JoinRequestNotificationMail } from "./app/identity.members.ts";
export { InProcessBreakGlassLimiterService } from "./services/in-process-break-glass-limiter.service.ts";
export { LocalDoorBreakGlassBindingRepository } from "./repositories/local/local.door-break-glass-binding.repository.ts";
export type { SsoConnectionBackofficePage } from "./repositories/sso-connection-backoffice.repository.ts";
export type { PrismaSsoConnectionBackofficeDatabase } from "./repositories/prisma/prisma.sso-connection-backoffice.repository.ts";
export { PrismaLegacySsoOrganizationRepository } from "./repositories/prisma/prisma.legacy-sso-organization.repository.ts";
export type { SsoConnectionRoutingRepository } from "./repositories/sso-connection-routing.repository.ts";
export {
  type PrismaSsoConnectionRoutingDatabase,
  PrismaSsoConnectionRoutingRepository,
} from "./repositories/prisma/prisma.sso-connection-routing.repository.ts";
export {
  type SsoMethodConfiguration,
  type SsoMethodDial,
  ssoMethodDialWith,
} from "./rules/sso-method-dial.rules.ts";
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
export { BetterAuthCeremonyBridgeService } from "./services/better-auth-ceremony-bridge.service.ts";
export { IdentityCeremoniesService } from "./services/better-auth-identity-ceremonies.service.ts";
export {
  BetterAuthIdentityStorageService,
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
export { IdentitySsoConnectionGrandfatherMigrationService } from "./services/system-migration-identity-connection-grandfather.service.ts";
export { IdentityIdentifierBackfillMigrationService } from "./services/system-migration-identity-identifier-backfill.service.ts";
export {
  IDENTITY_SECRET_HEAL_MIGRATION_NAME,
  IdentitySecretHealMigrationService,
} from "./services/system-migration-identity-secret-heal.service.ts";
export {
  ScimSyncLedgerWriterService,
  type ScimSyncLedgerWriterDeps,
  type ScimSyncStagedSender,
} from "./services/eventing-scim-sync-ledger.service.ts";
export {
  SsoConnectionTeardownDispatcherService,
  type ConnectionDirectoryRevocation,
} from "./services/sso-connection-teardown.service.ts";
export type { IdentityRepositories } from "./repositories/identity.repositories.ts";
export {
  BetterAuthIdentityBirthAdapter,
  type IdentityBirthScope,
} from "./services/better-auth-identity-birth.service.ts";
export { buildIdentityInfrastructure } from "./app/identity-composition.build.ts";
export { IdentityProducerPipelines } from "./app/identity-producer-composition.build.ts";
export {
  IdentityNewbornSweep,
  type IdentityMigrationsOptions,
  IdentityOrganizationMigrations,
  IdentityUserMigrations,
} from "./app/identity-migrations-composition.build.ts";
export {
  composeIdentityGuards,
  composeIdentityPipeline,
  type IdentityGuardsComposition,
} from "./eventing/user-identity.pipeline.ts";
export {
  composeJoinRequestNotifications,
  composeJoinRequestPipeline,
} from "./eventing/join-request.pipeline.ts";
export { composeScimSyncPipeline } from "./eventing/scim-sync.pipeline.ts";
export {
  composeSsoConnectionGraph,
  type SsoConnectionGraph,
} from "./eventing/sso-connection.pipeline.ts";
