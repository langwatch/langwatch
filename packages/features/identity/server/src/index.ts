/**
 * @langwatch/identity-server — the server-side runtime of the identity
 * platform (ADR-101, ADR-115), in the app-layer service/repository shape:
 * service CLASSES over repository INTERFACES.
 *
 *   IdentityGuards               veto-before-write over IdentityHeadsRepository;
 *                                one implementation for the calling path AND
 *                                the queue's staged re-run
 *   IdentityService              the five verbs: parse → guard → IdentityLedger.commit,
 *                                sliced by role into IdentityCeremonyWrites /
 *                                IdentityVerificationWrites / IdentityAdoptionWrites
 *   VerificationCeremonyService  PKCE magic-link mint / complete
 *   IdentityBackfillService      one user's ADR-101 §6 pass: adopt, establish,
 *                                detach orphans, prove
 *   crypto                       deriveIdentifierId, computeIdentifierHash,
 *                                mintUserHashKey, the PKCE helpers
 *   IdentityEmailService         the READ fork: User.email answered from the
 *                                identifiers for a finalized user
 *   identity-command-id          every form a command id takes, in one place
 *   identity-backfill-plan       what the legacy rows imply, as a pure plan
 *   ./better-auth                the ceremonies better-auth's databaseHooks
 *                                call; no adapter, no storage (ADR-116's
 *                                bridge phase)
 *
 * No storage engine lives here, no environment read, and no event-sourcing
 * framework: the heads, the ledger and the records are ports the app
 * implements (platform/app/src/server/app-layer/identity/repositories/ and
 * ledger.ts) and composes once in its runtime
 * (platform/app/src/server/app-layer/identity/runtime.ts). The pure half —
 * vocabulary, facts, the reducer, the errors — is `@langwatch/identity-contract`.
 *
 * Server-only by construction: nothing in the browser reaches this package,
 * and the app's frontend-boundary test fails the build the day that stops
 * being true. That is why node:crypto sits on the root entry rather than
 * behind a subpath.
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
 * The synthetic issuer better-auth 1.7 expects on an account row, exported
 * from the root as well as from `./better-auth` because it is a PERSISTED
 * format rather than a better-auth shape: a process that writes a credential
 * account row has to write the issuer this mints, and every one of those
 * processes should reach the same function rather than restate the prefix.
 * Reaching it through `./better-auth` would put better-auth's own types on
 * the import graph of a composition root that never touches the library.
 */
export { issuerForProviderId } from "./better-auth/account-queries";
/**
 * The row mappings the fold writes through and every guard reads back
 * through. Exported because the Postgres projection stores that write these
 * rows live with the fold that owns their shape (`@langwatch/identity-eventing`),
 * and a second copy of either mapping would eventually disagree with this one
 * about what a column means.
 */
export {
  type IdentifierRow,
  identifierFactToRow,
  identifierRowToFact,
  parseIdentifierLifecycleState,
} from "./repositories/prisma/prisma.identifier.mapper";
export {
  type MfaEnrollmentRow,
  mfaEnrollmentRowToState,
} from "./repositories/prisma/prisma.mfa-enrollment.mapper";
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
  AdminEmailPlatformOperators,
  SystemActorPlatformOperators,
  type PrismaSsoPlatformOperatorDatabase,
} from "./repositories/prisma/prisma.sso-platform-operators.repository";
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

// ---------------------------------------------------------------------------
// The composition half the platform application used to own
//
// Every module below was `platform/app/src/server/app-layer/identity/`: the
// Postgres repositories the guards and the fold read and write through, the two
// ledger writers, the join-request orchestration around the event-sourced
// lifecycle, and the instance's sign-in method policy. They moved WHOLE — same
// classes, same rules — with exactly three seams turned into arguments: the
// event stack (an {@link IdentityEventingPort} rather than a service locator),
// the shared rate-limit counter, and the deployment's four sign-in facts.
// ---------------------------------------------------------------------------
export { IdentityEventingPort } from "./ports/identity-eventing.port";
export {
  IDENTITY_CONVERGENCE_POLL_MS,
  IDENTITY_CONVERGENCE_TIMEOUT_MS,
  IdentityLedgerWriter,
  type IdentityLedgerWriterDeps,
  type IdentityStagedSender,
} from "./adapters/identity-ledger.adapter";
export {
  JOIN_REQUEST_CONVERGENCE_POLL_MS,
  JOIN_REQUEST_CONVERGENCE_TIMEOUT_MS,
  JoinRequestLedgerWriter,
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
export { InProcessBreakGlassLimiter } from "./adapters/in-process-break-glass-limiter.adapter";
export { LocalDoorBreakGlassBinding } from "./adapters/local-door-break-glass-binding.adapter";
export { PrismaIdentityVerificationRepository } from "./repositories/prisma/prisma.identity-verification.repository";
export { PrismaIdentityProjectionRepository } from "./repositories/prisma/prisma.identity-projection.repository";
export {
  PrismaJoinCandidateRepository,
  PrismaJoinRequestReadRepository,
  readDomainJoin,
} from "./repositories/prisma/prisma.join-request.repository";
export {
  PrismaJoinRequestProjectionRepository,
  rowToJoinRequest,
} from "./repositories/prisma/prisma.join-request-projection.repository";
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
  deploymentIsFederationCapable,
  deploymentOffersPasskeys,
  LOCAL_METHOD_SET,
  PASSKEY_METHOD,
  PASSWORD_METHOD,
  resolveFederatedMethod,
  resolveSignInMethodPolicy,
  signInMethodPolicyPortOver,
  type SignInMethodPolicyInputs,
} from "./services/signin-method-policy.service";
export {
  PrismaIdentityHeadsRepository,
  type PrismaIdentityHeadsDatabase,
} from "./repositories/prisma/prisma.identity-heads.repository";
export {
  PrismaIdentityReservationRepository,
  type PrismaIdentityReservationsDatabase,
} from "./repositories/prisma/prisma.identity-reservations.repository";
