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
 * vocabulary, facts, the reducer, the errors — is `@langwatch/identity`.
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
export { detachStrandsUser, IdentityGuards } from "./guards";
export {
  type BackfillAccountRow,
  type BackfillUserRow,
  type IdentityBackfillRepository,
} from "./identity-backfill.repository";
export {
  type PlannedIdentifier,
  planIdentifiers,
} from "./identity-backfill-plan";
export {
  IDENTITY_BACKFILL_ACTOR,
  type IdentityBackfillOutcome,
  IdentityBackfillService,
  type IdentityBackfillServiceDeps,
} from "./identity-backfill.service";
export { IdentityEmailService } from "./identity-email.service";
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
export type { IdentityHeadsRepository } from "./identity-heads.repository";
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
export { LinkProposalGuards } from "./link-proposal-guards";
export type {
  LinkProposalDecision,
  LinkProposalReadsRepository,
  LinkProposalRecord,
} from "./link-proposal.repository";
export {
  type LinkProposalDirectoryPort,
  LinkProposalService,
  type LinkProposalServiceDeps,
} from "./link-proposal.service";
export type { MfaEnrollmentRepository } from "./mfa-enrollment.repository";
export { MfaGuards } from "./mfa-guards";
export {
  expireMfaEnrollmentCommandId,
  mfaCeremonyCommandId,
  newMfaCommandId,
  newMfaEnrollmentId,
} from "./mfa-id";
export type { MfaLedger } from "./mfa-ledger";
export { MfaService } from "./mfa.service";
export {
  type SignInAccountLookupPort,
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
export {
  IdentityJitDisabledError,
  IdentityLinkProposedError,
} from "./signin-callback-errors";
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
  JoinRequestGuards,
  type JoinRequestGuardsDeps,
} from "./join-request-guards";
export {
  approveJoinCommandId,
  expireJoinCommandId,
  newJoinRequestCommandId,
  newJoinRequestId,
} from "./join-request-id";
export type { JoinRequestLedger } from "./join-request-ledger";
export type {
  JoinCandidateRepository,
  JoinRequestReadRepository,
} from "./join-request.repository";
export { JoinRequestService } from "./join-request.service";
export {
  retiredLetter,
  SCIM_APPLY_MAX_ATTEMPTS,
  ScimSyncGuards,
} from "./scim-sync-guards";
export { newScimSyncCommandId } from "./scim-sync-id";
export type { ScimSyncLedger } from "./scim-sync-ledger";
export type { ScimSyncReadRepository } from "./scim-sync.repository";
export {
  type LegacySsoOrganizationRepository,
  type SsoConnectionGrandfatherDeps,
  type SsoConnectionGrandfatherOutcome,
  SsoConnectionGrandfatherService,
} from "./sso-connection-grandfather.service";
export {
  SsoConnectionGuards,
  type SsoConnectionGuardsDeps,
} from "./sso-connection-guards";
export {
  grandfatherCommandId,
  grandfatheredSsoConnectionId,
  newSsoBreakGlassBindingId,
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
  SsoDomainClaimQueueRepository,
  SsoLicenseAuthorityRepository,
  SsoPlatformOperatorRepository,
} from "./sso-connection.repository";
export { SsoConnectionService } from "./sso-connection.service";
export type {
  SsoBreakGlassRepository,
  SsoBreakGlassWarningNotifier,
} from "./break-glass.repository";
export {
  SsoBreakGlassService,
  type SsoBreakGlassServiceDeps,
} from "./break-glass.service";
export {
  type SelfServeActor,
  type SelfServeBreakGlassBindingView,
  type SelfServeDnsRecordLocation,
  type SelfServeDnsRecordView,
  type SelfServeDomainClaimView,
  type SelfServeGoLiveView,
  type SelfServeIssuedDnsRecord,
  type SelfServeSetupView,
  type SsoBreakGlassReadPort,
  type SsoConnectionRoutingLookup,
  type SsoDomainFileFetch,
  type SsoDomainFileLookup,
  type SsoDomainProofLookup,
  type SsoDomainTxtLookup,
  type SsoLicenseProofPort,
  type SsoOrganizationMember,
  type SsoOrganizationMemberLookup,
  SsoSelfServeService,
  type SsoSelfServeContextPort,
  type SsoSelfServeServiceDeps,
  type SsoTestSignIn,
  type SsoTestSignInLookup,
} from "./sso-self-serve.service";
export {
  SSO_DOMAIN_REPROOF_BATCH,
  SsoDomainReproofService,
  type SsoDomainReproofNotifier,
  type SsoDomainReproofOutcome,
  type SsoDomainReproofServiceDeps,
  type SsoDomainReproofTarget,
  type SsoDomainReproofTargetRepository,
} from "./sso-domain-reproof.service";
export {
  SSO_CREDENTIAL_KINDS,
  type SsoCredentialKind,
  type SsoCredentialStore,
} from "./sso-credential-store";
export {
  connectionIsDialable,
  engineProviderFor,
  serviceProviderDetailsFor,
  type SsoEngineProviderRow,
  type SsoServiceProviderDetails,
} from "./sso-engine-provider";
export {
  discoveryEndpointFor,
  parseSamlIdpConfig,
  ssoIdpRegistrationSchema,
  ssoOidcRegistrationSchema,
  ssoSamlRegistrationSchema,
  type SsoIdpRegistration,
  type SsoIssuerDiscoveryPort,
  type SsoOidcRegistration,
  type SsoSamlIdpConfig,
  type SsoSamlRegistration,
  validateOidcRegistration,
  validateSamlRegistration,
} from "./sso-idp-registration";
export {
  IDENTITY_VERIFICATION_TTL_MS,
  type MintedEmailVerification,
  VerificationCeremonyService,
  type VerificationCeremonyDeps,
} from "./verification-ceremony.service";
