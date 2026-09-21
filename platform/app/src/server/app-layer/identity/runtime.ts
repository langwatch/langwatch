/**
 * The identity runtime: THE composition root (ADR-115 §4). The one place
 * Prisma, the migration-state table and the event-sourcing pipeline handle
 * meet `@langwatch/identity-server`'s services. Nothing else constructs an
 * IdentityService, a guard, or a ceremony; a consumer imports the composed
 * instance from here or is wrong.
 *
 * Only server-only modules may import this file: its graph reaches
 * `~/server/db` at module scope. Every environment read the services need
 * is a closure passed from here — the packages read no env of their own.
 */

import { fireActivityTrackingNurturing } from "@ee/billing/nurturing/hooks/activityTracking";
import { fireSsoAutoAddNurturingCalls } from "@ee/billing/nurturing/hooks/ssoAutoAdd";
import { ensureUserSyncedToCio } from "@ee/billing/nurturing/hooks/userSync";
import { PlanTypes } from "@ee/billing/planTypes";
import { ScimDeprovisionService } from "@ee/scim/scim-deprovision.service";
import {
  ScimOversightService,
  type ScimRedriveApplyPort,
} from "@ee/scim/scim-oversight.service";
import { PrismaScimReconciliationRepository } from "@ee/scim/scim-reconciliation.prisma.repository";
import { ScimReconciliationService } from "@ee/scim/scim-reconciliation.service";
import { ScimRequestLogService } from "@ee/scim/scim-request-log.service";
import { PrismaScimSsoUsers } from "@ee/scim/scim-sso-user.prisma.repository";
import { scimSyncLifecycle } from "@ee/scim/scim-sync.runtime";
import type { ScimSyncLifecycle } from "@ee/scim/scim-sync.service";
import { EventLogScimSyncActivityRepository } from "@ee/scim/scim-sync-event-log.repository";
import { ScimTokenService } from "@ee/scim/scim-token.service";
import { SsoBreakGlassService } from "@ee/sso/break-glass.service";
import {
  breakGlassHolderEligibility,
  LocalDoorBreakGlassBinding,
  RequiresLocalDoorAndBinding,
} from "@ee/sso/break-glass-binding";
import { IdentitySsoConnectionGrandfatherMigration } from "@ee/sso/connection-grandfather.migration";
import { LegacySsoDomainRoutingRepository } from "@ee/sso/legacy-sso-domain.prisma.repository";
import { PrismaLegacySsoOrganizationRepository } from "@ee/sso/legacy-sso-organization.prisma.repository";
import { AdminEmailPlatformOperators } from "@ee/sso/platform-operators";
import { configuredSocialProviderIds } from "@ee/sso/providers";
import { PrismaSsoAccountFactsRepository } from "@ee/sso/sso-account-facts.prisma.repository";
import { SsoArrivalService } from "@ee/sso/sso-arrival.service";
import { SsoAssertionService } from "@ee/sso/sso-assertion.service";
import { PrismaSsoBreakGlassRepository } from "@ee/sso/sso-break-glass.prisma.repository";
import { SsoConnectionService } from "@ee/sso/sso-connection.service";
import { PrismaSsoConnectionBackofficeRepository } from "@ee/sso/sso-connection-backoffice.prisma.repository";
import { SsoConnectionBackofficeService } from "@ee/sso/sso-connection-backoffice.service";
import { EventLogSsoConnectionHistoryRepository } from "@ee/sso/sso-connection-event-log.repository";
import { SsoConnectionGrandfatherService } from "@ee/sso/sso-connection-grandfather.service";
import { SsoConnectionGuards } from "@ee/sso/sso-connection-guards";
import { SsoConnectionHistoryService } from "@ee/sso/sso-connection-history.service";
import {
  newSsoBreakGlassBindingId,
  newSsoConnectionCommandId,
} from "@ee/sso/sso-connection-id";
import { PrismaSsoConnectionIssuers } from "@ee/sso/sso-connection-issuers.prisma.repository";
import { SsoConnectionLedgerWriter } from "@ee/sso/sso-connection-ledger";
import { PrismaSsoConnectionProjectionRepository } from "@ee/sso/sso-connection-projection.prisma.repository";
import {
  PrismaSsoConnectionReadRepository,
  PrismaSsoConnectionStrandingRepository,
  PrismaSsoDomainClaimQueueRepository,
} from "@ee/sso/sso-connection-reads.prisma.repository";
import { PrismaSsoConnectionRegistrationRepository } from "@ee/sso/sso-connection-registration.prisma.repository";
import { SsoConnectionDomainRoutingRepository } from "@ee/sso/sso-connection-routing.prisma.repository";
import { PrismaSsoCredentialStore } from "@ee/sso/sso-credential.prisma.repository";
import { SsoCredentialPolicy } from "@ee/sso/sso-credential-policy";
import { HttpsDomainProofFileLookup } from "@ee/sso/sso-domain-file-lookup";
import { SsoDomainReproofService } from "@ee/sso/sso-domain-reproof.service";
import { engineProviderFor } from "@ee/sso/sso-engine-provider";
import { platformSSOAllowed, resolveAuthProvider } from "@ee/sso/sso-gate";
import { HttpSsoIssuerDiscovery } from "@ee/sso/sso-issuer-discovery";
import { SsoLicenseRepository } from "@ee/sso/sso-license.repository";
import { PrismaSsoMembershipRepository } from "@ee/sso/sso-membership.prisma.repository";
import { ssoMethodDialWith } from "@ee/sso/sso-method-configured";
import { PrismaSsoMigrationCallbackPolicy } from "@ee/sso/sso-migration-callback-policy.prisma.repository";
import { PrismaSsoMigrationEvidenceRepository } from "@ee/sso/sso-migration-evidence.prisma.repository";
import { SsoMigrationFinalizationService } from "@ee/sso/sso-migration-finalization.service";
import { PrismaSsoLegacyIdentityRetirement } from "@ee/sso/sso-migration-legacy-retirement.prisma.repository";
import { ssoProviderConfigCipher } from "@ee/sso/sso-provider-config-cipher";
import { SsoSelfServeService } from "@ee/sso/sso-self-serve.service";
import {
  DnsDomainProofLookup,
  InstanceLicenseProof,
  LicenseDomainClaimAuthority,
  LoggingBreakGlassWarningNotifier,
  PrismaSsoDomainReproofTargets,
  PrismaSsoOrganizationMemberLookup,
  SsoSelfServeContextResolver,
} from "@ee/sso/sso-self-serve-adapters";
import { SsoTestArrivalService } from "@ee/sso/sso-test-arrival.service";
import {
  breakGlassIsLive,
  isOrganizationManagedDecision,
  normalizeIdentifierValue,
  type RoutingDecision,
  type SignInMethod,
  type SignInRoutingReasonCode,
  SSO_DNS_REPROOF_GRACE_MS,
  type SsoConnectionState,
} from "@langwatch/identity";
import {
  IdentityBackfillService,
  IdentityEmailService,
  IdentityGuards,
  IdentitySecretCarryService,
  IdentityService,
  JoinRequestGuards,
  JoinRequestService,
  LinkProposalGuards,
  LinkProposalService,
  MfaGuards,
  MfaService,
  newIdentityCommandId,
  SignInRouterService,
  VerificationCeremonyService,
} from "@langwatch/identity-server";
import type { IdentityAccountCeremonies } from "@langwatch/identity-server/better-auth";
import {
  bridgeAccountCeremonies,
  createIdentityStorageAdapter,
  IdentityAccountWriter,
  IdentityCeremonies,
  MfaCeremonies,
} from "@langwatch/identity-server/better-auth";
import { generate } from "@langwatch/ksuid";
import { RedisConfigService } from "@langwatch/redis-client";
import { compare, hash } from "bcrypt";
import type { BetterAuthOptions } from "better-auth";
import type { AdapterFactory } from "better-auth/adapters";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { nanoid } from "nanoid";

import { env } from "~/env.mjs";
import type { PrismaClient } from "~/generated/prisma/client";
import { auth0BridgeActive } from "~/utils/auth0-bridge";
import { captureException } from "~/utils/posthogErrorCapture";

import { changeAuth0Password } from "../../auth0/passwordService";
import { deploymentIssuesOwnPasswords } from "../../better-auth/config/email-and-password";
import type { SecondaryStorageDeps } from "../../better-auth/config/secondary-storage";
import { CredentialSessionGuard } from "../../better-auth/credential-session-guard";
import { BetterAuthDatabaseHooks } from "../../better-auth/hooks";
import { LastWayInGuard } from "../../better-auth/last-way-in";
import { PasskeySignUpRegistration } from "../../better-auth/passkey-signup";
import { PasswordResetSessionBridge } from "../../better-auth/password-reset-session";
import { RegisteredIssuers } from "../../better-auth/registeredIssuers";
import { BetterAuthSessionMinter } from "../../better-auth/session-minter";
import { SignUpConfirmationEndpoint } from "../../better-auth/sign-up-confirmation";
import { prisma } from "../../db";
import { PrismaProcessStore } from "../../event-sourcing/process-manager/stores/prismaProcessStore";
import { featureFlagService } from "../../featureFlag";
import { InviteService } from "../../invites/invite.service";
import { sendAddressConfirmationEmail } from "../../mailer/addressConfirmationEmail";
import { sendSignUpVerificationEmail } from "../../mailer/signUpVerificationEmail";
import { trackServerEvent } from "../../posthog";
import { getApp, tryGetApp } from "../app";
import { grantsLedgerWriter } from "../authz/ledger";
import { grantsService } from "../authz/runtime";
import { PrismaSystemMigrationStateRepository } from "../system-migrations/repositories/system-migration-state.prisma.repository";
import { systemMigrationsService } from "../system-migrations/runtime";
import { AccountIdentifiersService } from "./account-identifiers.service";
import { buildAddressConfirmationUrl } from "./address-confirmation-link";
import { IdentityAddressLockReaperService } from "./address-lock-reaper";
import { BetterAuthInstanceHandle } from "./better-auth-instance.adapter";
import { InProcessBreakGlassLimiter } from "./break-glass-limiter";
import { CredentialAccountService } from "./credential-account.service";
import { CredentialAccountStorageAdapter } from "./credential-account.storage-adapter";
import { resolveDialableInternalOrigins } from "./dialable-internal-origins";
import { IdentityIdentifierBackfillMigration } from "./identifier-backfill.migration";
import { IdentityLookupService } from "./identity-lookup.service";
import {
  BetterAuthLinkProposalDirectory,
  BetterAuthOperatorSessions,
  InviteServiceOperatorInvitations,
} from "./identity-lookup-adapters";
import {
  identityStorageTransactions,
  postgresTransactionOver,
} from "./identity-storage-transaction.adapter";
import {
  EmailJoinRequestNotifier,
  PrismaJoinMembership,
  PrismaJoinOfferDismissals,
  PrismaJoinSettings,
} from "./join-request-adapters";
import { JoinRequestLedgerWriter } from "./join-request-ledger";
import { JoinRequestsService } from "./join-requests.service";
import { LastWayInService } from "./last-way-in.service";
import { IdentityLedgerWriter } from "./ledger";
import { MemberProvenanceService } from "./member-provenance.service";
import { MfaLedgerWriter } from "./mfa-ledger";
import { OrganizationMfaService } from "./organization-mfa.service";
import {
  EmailOrganizationMfaNotifier,
  PrismaOrganizationConnectionFactors,
  PrismaOrganizationMemberFactors,
  PrismaOrganizationMfaSettings,
  PrismaSessionFactors,
} from "./organization-mfa-adapters";
import { PriorSessionService } from "./prior-session.service";
import { pinnedFetch, systemHostResolver } from "./public-egress";
import { PrismaCredentialAccountRepository } from "./repositories/credential-account.prisma.repository";
import { PrismaIdentityAccountsRepository } from "./repositories/identity-accounts.prisma.repository";
import { PrismaIdentityBackfillRepository } from "./repositories/identity-backfill.prisma.repository";
import { EventLogIdentityRepository } from "./repositories/identity-event-log.repository";
import { PrismaIdentityHeadsRepository } from "./repositories/identity-heads.prisma.repository";
import { PrismaIdentityLookupRepository } from "./repositories/identity-lookup.prisma.repository";
import { PrismaIdentityProjectionRepository } from "./repositories/identity-projection.prisma.repository";
import { PrismaIdentityReservationRepository } from "./repositories/identity-reservations.prisma.repository";
import { PrismaIdentityResolutionRepository } from "./repositories/identity-resolution.prisma.repository";
import { PrismaIdentitySecretCarryRepository } from "./repositories/identity-secret-carry.prisma.repository";
import { PrismaIdentityUsersRepository } from "./repositories/identity-users.prisma.repository";
import { PrismaIdentityVerificationRepository } from "./repositories/identity-verification.prisma.repository";
import {
  PrismaJoinCandidateRepository,
  PrismaJoinRequestReadRepository,
} from "./repositories/join-request.prisma.repository";
import { PrismaJoinRequestProjectionRepository } from "./repositories/join-request-projection.prisma.repository";
import { PrismaLastWayInRepository } from "./repositories/last-way-in.prisma.repository";
import { PrismaMemberProvenanceRepository } from "./repositories/member-provenance.prisma.repository";
import { PrismaMfaEnrollmentRepository } from "./repositories/mfa-enrollment.prisma.repository";
import { PrismaMfaEnrollmentProjectionRepository } from "./repositories/mfa-enrollment-projection.prisma.repository";
import { PrismaPasskeyRemovalRepository } from "./repositories/passkey-removal.prisma.repository";
import { PrismaPriorSessionRepository } from "./repositories/prior-session.prisma.repository";
import { PrismaSecretHealTenantSource } from "./repositories/secret-heal-tenant-source.prisma.repository";
import { PrismaSignUpHealthRepository } from "./repositories/sign-up-health.prisma.repository";
import {
  PrismaSignUpAccountDirectory,
  PrismaSignUpVerificationTokenStore,
} from "./repositories/signup-verification.prisma.repository";
import { IdentitySecretHealMigration } from "./secret-heal.migration";
import {
  PrismaSessionIdentifiers,
  PrismaSessionRecords,
  RedisSessionCache,
  VerifiedCallbackProviderAssertions,
} from "./session-adapters";
import { SessionBoundService } from "./session-bound.service";
import { SessionClaimsService } from "./session-claims.service";
import { SessionInventoryService } from "./session-inventory.service";
import { SessionRevocationService } from "./session-revocation.service";
import { SignInLockoutService } from "./sign-in-lockout.service";
import {
  AuditLogLockoutEvidence,
  AuditLogSignInSecurityReleaseEvidence,
  keyedIdentifierHasher,
  PrismaLockoutIdentity,
  PrismaLockoutPolicies,
  PrismaLockoutState,
  PrismaOrganizationMembership,
  PrismaOrganizationSessions,
  PrismaSessionActivity,
  PrismaSessionBoundPolicies,
  PrismaSignInSecuritySettings,
  RevocationSessionEnd,
} from "./sign-in-security-adapters";
import { SignUpHealthService } from "./sign-up-health.service";
import { SignUpIdentifierService } from "./sign-up-identifier";
import { ProjectionSignInAccountLookup } from "./signin-account-lookup";
import { SignInLinkEvidence } from "./signin-link-evidence";
import {
  deploymentOffersTwoStepVerification,
  resolveFederatedMethod,
  signInMethodPolicyPort,
} from "./signin-method-policy";
import { SignUpVerificationService } from "./signup-verification.service";
import { buildSignUpVerificationUrl } from "./signup-verification-link";
import { PrismaTwoStepAccount } from "./two-step-account.adapter";
import { TwoStepVerificationService } from "./two-step-verification.service";
import { BetterAuthTwoStepProtocol } from "./two-step-verification-adapters";
import { isAnyoneOnIdentityWrites, isUserOnIdentityWrites } from "./write-gate";

/**
 * The connection-id predicate, re-stated for the same reason: it composes
 * nothing, but it lives in `@langwatch/identity-server`, and that package is
 * one of the two the boundary test says better-auth may reach only through
 * here.
 */
export { looksLikeSsoConnectionId } from "@langwatch/identity";
/**
 * The method-set policy, re-stated on the runtime because the runtime is the
 * app's ONE door into app-layer identity (ADR-115) — and better-auth is the
 * caller the boundary test names. It composes nothing: these are policy
 * functions over the SSO gate and env, and they are exposed here rather than
 * imported sideways so `better-auth/` keeps a single identity import.
 */
export {
  deploymentIsFederationCapable,
  deploymentOffersPasskeys,
  resolveSignInMethodPolicy,
} from "./signin-method-policy";

const identityHeads = new PrismaIdentityHeadsRepository(prisma);
const identityUsers = new PrismaIdentityUsersRepository(prisma);
const ssoAccountFacts = new PrismaSsoAccountFactsRepository(prisma);
const organizationJoinProcessStore = new PrismaProcessStore(prisma);
let organizationJoinNotifier: EmailJoinRequestNotifier | null = null;
let organizationJoinMembership: PrismaJoinMembership | null = null;
const identityAccounts = new PrismaIdentityAccountsRepository(prisma);
const identityResolution = new PrismaIdentityResolutionRepository(prisma);
/** The address lock (ADR-116 §6): the one constraint the guards contend on. */
const identityReservations = new PrismaIdentityReservationRepository(prisma);
const migrationState = new PrismaSystemMigrationStateRepository(prisma);

/** The per-user fork as the services take it: one closure, one state
 *  repository, composed here rather than defaulted inside a service. The
 *  SAME predicate forks the ceremonies' writes and the email read — ADR-110's
 *  one switch, re-tenanted to users. */
export function isLatched({ userId }: { userId: string }): Promise<boolean> {
  return isUserOnIdentityWrites({ userId, state: migrationState });
}

/** The same question asked of the FLEET, for an `account` query that names
 *  no user (ADR-116 §7). */
export function isAnyoneLatched(): Promise<boolean> {
  return isAnyoneOnIdentityWrites({ state: migrationState });
}

/**
 * The write fork the storage adapter uses — and therefore the one question
 * the `databaseHooks` bridge has to ask before it states an attach the
 * adapter is about to state as well (ADR-116 §5).
 */
export const routesToIdentityBranch = isLatched;

/**
 * The read fork for `User.email`. A module-level singleton rather than a
 * per-call composition: it holds no request state, and the session boundary
 * resolves it on every authenticated request.
 */
const identityEmailService = new IdentityEmailService(identityHeads, isLatched);

export function identityEmail(): IdentityEmailService {
  return identityEmailService;
}

/**
 * The write surface. Composed per call like `grantsService()`: the ledger
 * writer resolves the pipeline handle lazily, so a ceremony composed before
 * the App exists (better-auth builds its options at module load) still
 * appends once one does.
 */
export function identityService(): IdentityService {
  return new IdentityService(
    identityGuards(),
    new IdentityLedgerWriter({
      projectionStore: identityProjectionStore(),
      heads: identityHeads,
    }),
  );
}

/**
 * ADR-117 §3's two-sided evidence, wired at the one seam better-auth offers.
 *
 * The rule itself is `linkRefusalFor`, shared with
 * `SignInCallbackLinkingService` so the two cannot drift; what this composes
 * is the reads it needs and the proposal a refusal leaves behind. See
 * `SignInLinkEvidence` for what it judges and what it deliberately does not.
 */
/**
 * Why somebody is looking at the signed-out screen, when the answer is
 * knowable (ADR-117).
 *
 * Composed here rather than at the router so the query stays in the
 * repository tier: the procedure asks a service, the service asks a port, and
 * only the port spells Prisma. See `PriorSessionService` for what may be said
 * about a session and why a REVOKED one answers like no session at all.
 */
export function priorSession(): PriorSessionService {
  return new PriorSessionService({
    repository: new PrismaPriorSessionRepository(prisma),
    now: () => new Date(),
  });
}

export function signInLinkEvidence(): SignInLinkEvidence {
  return new SignInLinkEvidence({
    repository: ssoAccountFacts,
    proposeLink: (input) => identityService().proposeLink(input),
    now: Date.now,
    newCommandId: newIdentityCommandId,
    newProposalId: () => generate("idlink").toString(),
  });
}

/** The guards, over all three of their repositories (ADR-116 §6). */
export function identityGuards(): IdentityGuards {
  return new IdentityGuards(identityHeads, identityUsers, identityReservations);
}

/** The fold's store, which also releases the address locks a user stops
 *  holding — composed here so both the pipeline and the ledger's wait read the
 *  same instance shape. */
export function identityProjectionStore(): PrismaIdentityProjectionRepository {
  return new PrismaIdentityProjectionRepository(prisma, identityReservations);
}

export function verificationCeremony(): VerificationCeremonyService {
  return new VerificationCeremonyService(
    new PrismaIdentityVerificationRepository(prisma),
    identityHeads,
    identityService(),
    { isLatched },
  );
}

/** Both pass-time directions of the bridge mirror's row half (ADR-116 §4):
 *  the latch's one-time carry, and the reverse heal. */
const identitySecretCarryService = new IdentitySecretCarryService(
  new PrismaIdentitySecretCarryRepository(prisma),
);

export function identitySecretCarry(): IdentitySecretCarryService {
  return identitySecretCarryService;
}

/**
 * The account's own sign-in addresses (the authentication settings surface).
 *
 * Composed per call like the write surface it uses, and given its mailer and
 * link builder as closures rather than importing them itself: the service is
 * the app's, but it holds no env and renders no mail.
 */
export function accountIdentifiers(): AccountIdentifiersService {
  return new AccountIdentifiersService({
    heads: identityHeads,
    identity: identityService(),
    ceremony: verificationCeremony(),
    deps: {
      sendConfirmation: sendAddressConfirmationEmail,
      buildConfirmationUrl: buildAddressConfirmationUrl,
      newCommandId: newIdentityCommandId,
      now: () => Date.now(),
    },
  });
}

export function identityBackfill(): IdentityBackfillService {
  return new IdentityBackfillService(
    new PrismaIdentityBackfillRepository(prisma),
    identityUsers,
    identityService(),
    identitySecretCarryService,
  );
}

/** The D01 backfill as the migrations runtime registers it (tenant = user). */
export function identifierBackfillMigration(): IdentityIdentifierBackfillMigration {
  return new IdentityIdentifierBackfillMigration(identityBackfill());
}

/** The reverse mirror's heal leg, as its own never-terminal pass — see the
 *  migration's own docblock for why it cannot be a step in the backfill. */
export function identitySecretHealMigration(): IdentitySecretHealMigration {
  return new IdentitySecretHealMigration({
    secrets: identitySecretCarryService,
    candidateTenants: new PrismaSecretHealTenantSource(prisma),
  });
}

/**
 * What better-auth's own `databaseHooks` call (ADR-101 §2): three methods
 * bound to `account.create.before`, `account.delete.before` and
 * `user.delete.before` in `server/better-auth/index.ts`, every one of which
 * returns having done nothing for a user whose backfill has not finalized.
 * The gate ships closed, so wiring them changes nothing on its own.
 */
export function identityCeremonies(): IdentityCeremonies {
  return new IdentityCeremonies(
    identityHeads,
    identityUsers,
    identityService(),
    // The ceremonies fork on the SAME question the storage adapter does,
    // so they take the same gate (ADR-116 §5).
    isLatched,
    { now: Date.now, newCommandId: newIdentityCommandId },
  );
}

/**
 * The two account ceremonies as `databaseHooks` bind them (ADR-116 §5): the
 * SAME instances, deferring for every user the storage adapter routes to the
 * identity branch, because the adapter states those facts itself and a second
 * statement in the same request appends the event twice.
 */
export function identityBridgeCeremonies(): Pick<
  IdentityAccountCeremonies,
  "beforeAccountCreate" | "beforeAccountDelete"
> {
  return bridgeAccountCeremonies({
    ceremonies: identityCeremonies(),
    routesToIdentity: routesToIdentityBranch,
  });
}

/**
 * The break-glass budget is per PROCESS, so it is a module singleton — a
 * per-call limiter would count to one forever and limit nothing.
 */
const breakGlassLimiter = new InProcessBreakGlassLimiter();

const legacySsoDomainRouting = new LegacySsoDomainRoutingRepository(
  prisma,
  resolveFederatedMethod,
);

/**
 * Which method a connection is actually dialed through (D09) — the seam where
 * the two engines coexist, composed from its two ports. The decision itself is
 * `sso-method-configured.ts`; what lives here is where each answer comes
 * from.
 */
const ssoConnectionIssuers = new PrismaSsoConnectionIssuers(prisma);

const ssoMethodDial = ssoMethodDialWith({
  mountedMethodId: async () => (await resolveFederatedMethod())?.id ?? null,
  engineHoldsProvider: async ({ connectionId }) =>
    (await ssoConnectionIssuers.findRegisteredProvider({ connectionId })) !==
    null,
});

/**
 * The projection-backed domain lookup (D04, D09). `configured` means what it
 * has always meant — whether a sign-in sent here would ARRIVE anywhere — and
 * since D09 there are two ways for that to be true: the provider this
 * deployment mounts from its environment, and a provider this organization
 * registered for itself. `ssoMethodDial` is the seam where both answer, and it
 * is what makes the two engines coexist rather than take turns.
 */
const ssoConnectionDomainRouting = new SsoConnectionDomainRoutingRepository(
  prisma,
  ssoMethodDial,
);

/** One router owns connection/legacy precedence, method policy and the shared
 * break-glass budget. Persisted migration routing remains in the connection reader. */
const signInRouterService = new SignInRouterService({
  domains: {
    legacy: legacySsoDomainRouting,
    connections: ssoConnectionDomainRouting,
  },
  policy: signInMethodPolicyPort,
  breakGlass: breakGlassLimiter,
  accounts: new ProjectionSignInAccountLookup({
    heads: identityHeads,
    legacy: identityUsers,
    isLatched,
    // The same predicate the method policy gates the branded buttons on
    // (`signin-method-policy.ts`). The policy additionally requires the
    // resolved, license-checked method to be auth0; this composition-time
    // read cannot await that, and does not need to — a bridge id the policy
    // never offered drops out of ranking, which intersects with the policy's
    // own default set.
    auth0BridgeIsActive: auth0BridgeActive({
      isSaas: env.IS_SAAS,
      authProvider: env.NEXTAUTH_PROVIDER,
    }),
    // The same set the policy builds its rail from, so a provider cut over to
    // its native client routes its brokered accounts to the button the rail
    // actually draws. Both readings are of the mounted providers, which do
    // not change after boot.
    mountedSocialMethodIds: configuredSocialProviderIds(env),
  }),
});

export function signInRouter(): SignInRouterService {
  return signInRouterService;
}

/**
 * Whether an ORGANIZATION's own connection governs this address (D04).
 *
 * The router already answers it — a live domain connection outranks
 * everything it knows — so this asks the router rather than re-deriving the
 * rule beside it, and reads only the part of the answer that names a
 * connection. `connectionId !== null` is what makes it an organization's
 * claim on the address: an instance-level redirect (the deployment's own sole
 * federated method, the Auth0 connection bridge) carries no connection and is
 * not somebody's company saying how its people sign in.
 *
 * Every caller is a REFUSAL — the credential boundary and the first-password
 * write — so a router that throws must not be read as "no connection". It is
 * left to throw: on a deployment that mandates SSO for this address, failing
 * open would hand out exactly the local password the connection exists to
 * prevent.
 */
export async function addressRoutesToConnection({
  email,
}: {
  email: string;
}): Promise<boolean> {
  return (await connectionGoverningAddress({ email })) !== null;
}

/**
 * The same question, answered with the connection rather than with a yes.
 *
 * Every caller of `addressRoutesToConnection` is a refusal that needs nothing
 * but the yes. The native-social bounce needs the connection itself, because
 * its refusal carries the place to go instead — so the two ask once, here,
 * and cannot come to different conclusions about whose address this is.
 *
 * Left to throw for the reason stated above: on a deployment that mandates
 * single sign-on for this address, failing open would hand out the very door
 * the connection exists to close.
 */
export async function connectionGoverningAddress({
  email,
}: {
  email: string;
}): Promise<{ connectionId: string } | null> {
  const decision = await signInRouter().route({ identifier: email });
  if (decision.outcome !== "redirect_to_connection") return null;
  const connectionId =
    decision.methodSet.find((method) => method.connectionId !== null)
      ?.connectionId ?? null;
  return connectionId === null ? null : { connectionId };
}

let credentialSessionGuard: CredentialSessionGuard | undefined;

export function credentialSessions(): CredentialSessionGuard {
  credentialSessionGuard ??= new CredentialSessionGuard(
    SsoCredentialPolicy.create({
      router: signInRouter(),
      connections: new PrismaSsoConnectionReadRepository(prisma),
      breakGlass: ssoBreakGlass(),
    }),
  );
  return credentialSessionGuard;
}

export type LocalSignUpDecision =
  | {
      outcome: "enroll";
      methodSet: readonly SignInMethod[];
      reasonCode: SignInRoutingReasonCode;
    }
  | {
      outcome: "redirect";
      methodSet: readonly SignInMethod[];
      reasonCode: SignInRoutingReasonCode;
    }
  | {
      outcome: "existing_account";
      methodSet: readonly [];
      reasonCode: SignInRoutingReasonCode;
    }
  | {
      outcome: "unavailable";
      methodSet: readonly [];
      reasonCode: SignInRoutingReasonCode;
    };

function isManagedDomainFallback(decision: RoutingDecision): boolean {
  return (
    decision.outcome !== "redirect_to_connection" &&
    isOrganizationManagedDecision(decision)
  );
}

export async function decideLocalSignUp(
  email: string,
  deps: {
    router: SignInRouterService;
    findUserIdByEmail(normalizedValue: string): Promise<string | null>;
    resolveDefaultMethods(): Promise<readonly SignInMethod[]>;
    passwordIsAllowed(): Promise<boolean>;
  },
): Promise<LocalSignUpDecision> {
  const decision = await deps.router.route({ identifier: email });
  if (isManagedDomainFallback(decision)) {
    return {
      outcome: "unavailable",
      methodSet: [],
      reasonCode: decision.reasonCode,
    };
  }
  if (decision.outcome === "redirect_to_connection") {
    return {
      outcome: "redirect",
      methodSet: decision.methodSet,
      reasonCode: decision.reasonCode,
    };
  }
  if (decision.reasonCode === "connection_suspended") {
    return {
      outcome: "unavailable",
      methodSet: [],
      reasonCode: decision.reasonCode,
    };
  }
  const existing = await deps.findUserIdByEmail(
    normalizeIdentifierValue(email),
  );
  if (existing !== null) {
    return {
      outcome: "existing_account",
      methodSet: [],
      reasonCode: "account_methods",
    };
  }

  let methodSet: readonly SignInMethod[];
  if (decision.outcome === "route_to_signup") {
    methodSet = await deps.resolveDefaultMethods();
  } else if (
    decision.reasonCode === "method_not_licensed" ||
    decision.reasonCode === "method_not_configured"
  ) {
    methodSet = decision.methodSet;
  } else {
    return {
      outcome: "unavailable",
      methodSet: [],
      reasonCode: decision.reasonCode,
    };
  }

  if (!(await deps.passwordIsAllowed())) {
    methodSet = methodSet.filter((method) => method.kind !== "password");
  }
  if (methodSet.length === 0) {
    return {
      outcome: "unavailable",
      methodSet: [],
      reasonCode: decision.reasonCode,
    };
  }

  return { outcome: "enroll", methodSet, reasonCode: decision.reasonCode };
}

export async function localSignUpDecision(
  email: string,
): Promise<LocalSignUpDecision> {
  return decideLocalSignUp(email, {
    router: signInRouter(),
    findUserIdByEmail: (normalizedValue) =>
      identityUsers.findUserIdByEmail({ normalizedValue }),
    resolveDefaultMethods: async () =>
      (await signInMethodPolicyPort.resolvePolicy()).defaultMethods,
    // Email mode first, because it answers on its own; the switch is only
    // about a deployment that ALSO federates keeping a password door.
    passwordIsAllowed: async () =>
      (await resolveAuthProvider()) === "email" ||
      deploymentIssuesOwnPasswords(env),
  });
}

/**
 * The SSO connection write surface (D04, ADR-117 §5). Composed per call like
 * the identity write surface: the ledger writer resolves the pipeline handle
 * lazily, so a command composed before the App exists still appends once one
 * does.
 *
 * This is the ONLY way a connection changes. Ops actions, the grandfather
 * migration and D05's self-service all call these verbs; nothing writes an
 * `SsoConnection` row, because the row is a projection of this log.
 */
export function ssoConnections(): SsoConnectionService {
  return new SsoConnectionService(
    new SsoConnectionGuards({
      connections: new PrismaSsoConnectionReadRepository(prisma),
      registrationSlots: new PrismaSsoConnectionRegistrationRepository(prisma),
      breakGlass: activationBreakGlassPort(),
      stranding: new PrismaSsoConnectionStrandingRepository(prisma),
      platformOperators: new AdminEmailPlatformOperators(identityUsers),
      licenseAuthority: new LicenseDomainClaimAuthority(),
    }),
    new SsoConnectionLedgerWriter({
      projectionStore: new PrismaSsoConnectionProjectionRepository(
        prisma,
        ssoEngineProviderDerivation,
      ),
    }),
  );
}

/**
 * The credential vault the connection's references point at (D09 — see
 * specs/identity/sso-idp-termination.feature). A module singleton because it
 * holds nothing but the Prisma handle and both the command path and the fold
 * need the same one.
 */
const ssoCredentials = new PrismaSsoCredentialStore(prisma);

/**
 * How the engine's provider row is derived from a connection's folded state.
 *
 * Exported as one function, given to BOTH projection-store construction sites
 * (the ledger writer's and the pipeline registry's), because the two are the
 * same projection reached two ways and a derivation that differed between
 * them would be two answers to "what is registered".
 */
export const ssoEngineProviderDerivation = ({
  connection,
}: {
  connection: SsoConnectionState;
}) =>
  engineProviderFor({
    connection,
    credentials: ssoCredentials,
    baseUrl: env.NEXTAUTH_URL ?? "",
    providerConfig: ssoProviderConfigCipher,
  });

let breakGlassService: SsoBreakGlassService | undefined;

export function ssoBreakGlass(): SsoBreakGlassService {
  if (breakGlassService) return breakGlassService;

  const memberships = new PrismaSsoMembershipRepository(prisma);
  breakGlassService = new SsoBreakGlassService({
    bindings: new PrismaSsoBreakGlassRepository(prisma),
    notifier: new LoggingBreakGlassWarningNotifier(),
    newBindingId: newSsoBreakGlassBindingId,
    // A grant requires an administrator who already holds a local password.
    holderIsEligible: breakGlassHolderEligibility({
      isAdministrator: async ({ organizationId, userId }) =>
        (await memberships.countEligibleAdministrator({
          organizationId,
          userId,
        })) > 0,
      holdsPassword: ({ userId }) =>
        credentialAccounts().hasPassword({ userId }),
    }),
  });
  return breakGlassService;
}

/**
 * Activation's break-glass precondition, as of D05: a live binding AND a
 * local door for it to be a way in through.
 *
 * Both, because they answer different halves of the same question. A binding
 * on an installation that mounts no local method names somebody who cannot
 * actually sign in; a local door with nobody named is the pre-D05 answer,
 * which activation was always going to outgrow. Requiring both is the only
 * reading under which "somebody can still get in" is true.
 */
function activationBreakGlassPort(): RequiresLocalDoorAndBinding {
  return new RequiresLocalDoorAndBinding({
    localDoor: new LocalDoorBreakGlassBinding(),
    bindings: ssoBreakGlass(),
  });
}

/**
 * The operator queue's read (D05), which is disputes only: a published
 * record decides every uncontested claim, so what is left for a person is a
 * domain two organizations both claim.
 */
export function ssoDomainClaimQueue(): PrismaSsoDomainClaimQueueRepository {
  return new PrismaSsoDomainClaimQueueRepository(prisma);
}

/**
 * Constructed once; the context resolver reads mutable organization flags
 * on each call.
 */
let selfServeService: SsoSelfServeService | undefined;

export function ssoSelfServe(): SsoSelfServeService {
  if (selfServeService) return selfServeService;
  const migrationEvidence = PrismaSsoMigrationEvidenceRepository.create({
    prisma,
    recovery: activationBreakGlassPort(),
    holdsPassword: ({ userId }) => credentialAccounts().hasPassword({ userId }),
  });
  const licenseProof = new InstanceLicenseProof(
    new SsoLicenseRepository(prisma),
  );
  selfServeService = new SsoSelfServeService({
    connections: ssoConnections,
    reads: new PrismaSsoConnectionReadRepository(prisma),
    legacy: new PrismaLegacySsoOrganizationRepository(prisma),
    context: new SsoSelfServeContextResolver({
      featureFlags: featureFlagService,
      licenseProof,
    }),
    proofs: new DnsDomainProofLookup(),
    files: new HttpsDomainProofFileLookup(),
    credentials: ssoCredentials,
    // The guard refuses a private address because the issuer came off a
    // form. The two addresses somebody named in advance — an operator's own
    // provider, and the simulator — are the two it must not refuse, and they
    // are the same two the engine already dials at sign-in.
    discovery: new HttpSsoIssuerDiscovery(
      // The PAIRED fetch, not the global one. The dispatcher the guard pins
      // each hop with comes from the workspace's undici and Node's built-in
      // fetch rejects it outright, so handing the global in here reported
      // every issuer unreachable however well it answered.
      pinnedFetch,
      systemHostResolver,
      resolveDialableInternalOrigins({
        trustedIdpOrigins: env.SSO_TRUSTED_IDP_ORIGINS,
        idpSimulatorUrl: env.LANGWATCH_IDPSIM_URL,
        isProduction: env.NODE_ENV === "production",
      }),
    ),
    baseUrl: env.NEXTAUTH_URL ?? "",
    // The evidence a test sign-in happened is the account the engine wrote,
    // read here rather than recorded anywhere: activation carries the id of
    // an account that exists, or it is refused.
    testSignIns: ssoAccountFacts,
    // The READ half of break glass only. Granting and renewing stay on
    // `ssoBreakGlass()`, which the setup service never holds — this surface
    // lists the ways back in and never writes one.
    breakGlass: ssoBreakGlass(),
    members: new PrismaSsoOrganizationMemberLookup(prisma, ({ userId }) =>
      credentialAccounts().hasPassword({ userId }),
    ),
    migrations: migrationEvidence,
    finalization: new SsoMigrationFinalizationService({
      connections: ssoConnections,
      evidence: migrationEvidence,
      retirement: new PrismaSsoLegacyIdentityRetirement({
        prisma,
        identity: identityService(),
        accounts: identityCeremonies(),
        directories: ScimTokenService.create(prisma),
        now: Date.now,
        newCommandId: newIdentityCommandId,
      }),
      newCommandId: newSsoConnectionCommandId,
    }),
  });
  return selfServeService;
}

/**
 * The sweep that re-reads the records proving domains (ADR-123). Composed per
 * call like every write surface here, and the grace window is stated once,
 * HERE, rather than read inside the package: how long a customer keeps
 * vouching after their record goes missing is a product decision this
 * composition root owns.
 */
export function ssoDomainReproof(): SsoDomainReproofService {
  return new SsoDomainReproofService({
    connections: ssoConnections,
    targets: new PrismaSsoDomainReproofTargets(prisma),
    proofs: new DnsDomainProofLookup(),
    files: new HttpsDomainProofFileLookup(),
    graceMs: SSO_DNS_REPROOF_GRACE_MS,
  });
}

/**
 * The join-request write surface (D12, ADR-117). Composed per call like the
 * two above: the ledger writer resolves the pipeline handle lazily, so a
 * command composed before the App exists still appends once one does.
 *
 * This is the ONLY way a request changes. The sign-up interstitial, the
 * members panel, the auto-join policy and the expiry wake all call these
 * verbs; nothing writes a `JoinRequest` row, because the row is a projection
 * of this log.
 */
export function joinRequests(): JoinRequestService {
  return new JoinRequestService(
    new JoinRequestGuards({
      requests: new PrismaJoinRequestReadRepository(prisma),
    }),
    new JoinRequestLedgerWriter({
      projectionStore: new PrismaJoinRequestProjectionRepository(prisma),
    }),
  );
}

function organizationJoinNotifications(): EmailJoinRequestNotifier {
  // The adapter imports this runtime's lifecycle factory; construct after imports settle.
  return (organizationJoinNotifier ??= new EmailJoinRequestNotifier(
    prisma,
    organizationJoinProcessStore,
  ));
}

export function joinMembership(): PrismaJoinMembership {
  return (organizationJoinMembership ??= new PrismaJoinMembership(
    prisma,
    grantsLedgerWriter(),
  ));
}

/**
 * Everything AROUND the lifecycle: matching, the reveal discipline, the rate
 * limits, the notifications, and how an approval becomes a membership.
 *
 * `autoJoinLicensed` and `enabled` arrive as closures rather than as reads
 * inside the service, for the reason every other seam here does: the packages
 * read no env, and the licence asymmetry — the gate holds `auto` and lets
 * `request` through — is a decision this composition root states once.
 */
export function joinRequestsService(): JoinRequestsService {
  return new JoinRequestsService({
    requests: joinRequests(),
    reads: new PrismaJoinRequestReadRepository(prisma),
    candidates: new PrismaJoinCandidateRepository(prisma),
    membership: joinMembership(),
    notifier: organizationJoinNotifications(),
    settings: new PrismaJoinSettings(prisma),
    dismissals: new PrismaJoinOfferDismissals(prisma),
    // The licence asymmetry, stated once: the gate that has always held
    // single sign-on holds AUTOMATIC joining, because that is federation —
    // the deployment decides who counts as a colleague and admits them with
    // nobody in the loop. Asking to join is not gated and never reads this,
    // which is what keeps "my company is invisible" fixed on precisely the
    // self-hosted deployments that have no other way out.
    autoJoinLicensed: () => platformSSOAllowed(),
    // The organization's own plan, resolved the one way the app resolves
    // plans — the provider that answers for a subscription row on Cloud and
    // for a signed license self-hosted. Read per call rather than captured,
    // so an organization that upgrades this morning can open its door this
    // morning. Closing it never reaches here.
    joinPolicyEntitled: async ({ organizationId }) =>
      (await getApp().planProvider.getActivePlan({ organizationId })).type ===
      PlanTypes.ENTERPRISE,
  });
}

/**
 * Why each member of an organization is here, for the members list.
 *
 * Reads only facts written for other reasons — the directory's identifier
 * mapping, the join-request projection and the invitation table — so a
 * member's provenance is answerable for people who joined long before the
 * chip that shows it existed.
 */
export function memberProvenance(): MemberProvenanceService {
  return new MemberProvenanceService({
    reads: new PrismaMemberProvenanceRepository(prisma),
  });
}

/**
 * The orphaned-organization rate (D12), for the operator surface.
 *
 * Composed off the same Prisma client everything else here uses, and reading
 * only tables that have been written all along — which is what lets an
 * operator ask about a window that closed before this deliverable existed.
 */
export function signUpHealth(): SignUpHealthService {
  return new SignUpHealthService({
    repository: new PrismaSignUpHealthRepository(prisma),
  });
}

/**
 * How many backup codes a set holds (D06).
 *
 * Stated here rather than left to the two-factor plugin's default, because
 * two places need the same number and one of them is not the plugin: the
 * plugin issues the codes, and the `MfaEnrollment` aggregate records HOW MANY
 * were issued so "how many are left" can be answered from the log without the
 * log ever knowing a code. A default that drifted would make that count a
 * lie.
 */
export const BACKUP_CODE_COUNT = 10;

/**
 * The two-step verification write surface (D06). The ONLY way an
 * `MfaEnrollment` fact comes into being.
 *
 * Composed per call like the identity write surface: the ledger writer
 * resolves the pipeline handle lazily, so a ceremony composed before the App
 * exists — and better-auth builds its options at module load — still appends
 * once one does.
 */
export function mfaEnrollments(): MfaService {
  return new MfaService(
    new MfaGuards(new PrismaMfaEnrollmentRepository(prisma)),
    new MfaLedgerWriter({
      projectionStore: new PrismaMfaEnrollmentProjectionRepository(prisma),
    }),
  );
}

/**
 * What better-auth's two-factor ENDPOINTS call (D06): the lifecycle fact each
 * completed call implies.
 *
 * Endpoint hooks rather than database hooks, because better-auth's
 * `databaseHooks` do not fire for a plugin's own tables — a `TwoFactor` row
 * appearing is invisible to the identity ceremonies that handle `Account` and
 * `User`, which is why the aggregate had no writer at all until now.
 *
 * Nothing on it can see a secret or a code: the commands it dispatches have
 * no field for one.
 */
export function mfaCeremonies(): MfaCeremonies {
  return new MfaCeremonies({
    mfa: mfaEnrollments(),
    enrollments: new PrismaMfaEnrollmentRepository(prisma),
    backupCodeCount: BACKUP_CODE_COUNT,
    now: Date.now,
  });
}

/**
 * Which of a user's organizations require a second factor (D06).
 *
 * Composed here because better-auth asks it while deciding whether a session
 * may proceed, and the boundary test holds that better-auth reaches app-layer
 * identity through this file or not at all. A direct import of the adapter
 * would be the first exception to that, for a read that has a composition
 * root already.
 */
export function twoStepAccount(): PrismaTwoStepAccount {
  return new PrismaTwoStepAccount(prisma);
}

/**
 * The organization's membership condition and its enrollment gate (D06).
 *
 * There is deliberately no session port in these dependencies. Turning the
 * requirement on ends no session, and the way that stays true through every
 * later edit is that this composition hands the service nothing it could end
 * one with.
 */
export function organizationMfa(): OrganizationMfaService {
  return new OrganizationMfaService({
    settings: new PrismaOrganizationMfaSettings(prisma),
    sessions: new PrismaSessionFactors(prisma),
    members: new PrismaOrganizationMemberFactors(prisma),
    connections: new PrismaOrganizationConnectionFactors(prisma),
    notifier: new EmailOrganizationMfaNotifier(
      prisma,
      async ({ userId, legacyEmail }) => {
        if (!(await isLatched({ userId }))) return legacyEmail;
        return identityEmail().resolveEmail({ userId });
      },
    ),
    // Stated once, here, like every other environment read this root owns.
    offered: deploymentOffersTwoStepVerification,
    // The plan, resolved the one way the app resolves plans: the provider
    // that answers for a subscription row on Cloud and for a signed license
    // self-hosted. Read per call rather than captured, so an organization
    // that upgrades this morning can turn the requirement on this morning.
    entitled: async ({ organizationId }) =>
      (await getApp().planProvider.getActivePlan({ organizationId })).type ===
      PlanTypes.ENTERPRISE,
  });
}

/**
 * What a session records at mint (D06): which sign-in method minted it, and
 * what that sign-in proved.
 *
 * Composed here like everything else, and reached from better-auth's own
 * `databaseHooks.session.create.before`. There is no write port on it: it
 * answers claims for a row better-auth is about to create, and nothing in it
 * can create, change or end a session of its own.
 */
const verifiedCallbackProviderAssertions =
  new VerifiedCallbackProviderAssertions();

export function sessionCallbackEvidence(): VerifiedCallbackProviderAssertions {
  return verifiedCallbackProviderAssertions;
}

export function sessionClaims(): SessionClaimsService {
  return new SessionClaimsService({
    identifiers: new PrismaSessionIdentifiers(
      prisma,
      identityStorageTransactions,
    ),
    assertions: verifiedCallbackProviderAssertions,
  });
}

const sessionRecords = new PrismaSessionRecords(prisma);
const sessionCache = new RedisSessionCache();
const sessionRevocationService = new SessionRevocationService({
  records: sessionRecords,
  cache: sessionCache,
});
const sessionInventoryService = new SessionInventoryService({
  records: sessionRecords,
  revocation: sessionRevocationService,
});

export function sessionInventory(): SessionInventoryService {
  return sessionInventoryService;
}

/** Production shares one revocation service. Tests and transactional callers
 * may supply a different database client while retaining the cache policy. */
export function sessionRevocation({
  prisma: client = prisma,
}: {
  prisma?: PrismaClient;
} = {}): SessionRevocationService {
  if (client === prisma) return sessionRevocationService;
  return new SessionRevocationService({
    records: new PrismaSessionRecords(client),
    cache: sessionCache,
  });
}

/**
 * The back office's own view of connections (D05 tier 1).
 *
 * Composed here rather than in the tRPC router for the ordinary reason: a
 * route names a service, and which store that service reads is the
 * composition root's business. The router held the repository directly and
 * therefore held `prisma` too, which is the one import that makes a transport
 * file a persistence file.
 */
export function ssoConnectionBackoffice(): SsoConnectionBackofficeService {
  return new SsoConnectionBackofficeService({
    reads: new PrismaSsoConnectionBackofficeRepository(prisma),
    connections: ssoConnections,
    history: ssoConnectionHistory(),
  });
}

/**
 * The two sign-in security rules an organization can set: locking an account
 * after repeated failures (GAC-09) and bounding how long a browser session
 * lasts (GAC-10).
 *
 * The two policy adapters are HELD rather than built per call, which is the
 * one thing this composition has to get right. Each keeps the
 * installation-wide answer - "has anybody here set one of these at all" - for
 * thirty seconds, and that answer is the early-out that keeps both features
 * off the hot path entirely on a deployment that has not turned them on.
 * Rebuilding the adapter per call would throw the answer away every time and
 * turn the cheap question into a query per sign-in and per authenticated
 * request.
 */
const lockoutPolicies = new PrismaLockoutPolicies(prisma);
const sessionBoundPolicies = new PrismaSessionBoundPolicies(prisma);

/** Forgets both cached installation-wide answers, for a save that changed one. */
export function forgetSignInSecurityPolicies(): void {
  lockoutPolicies.forget();
  sessionBoundPolicies.forget();
}

export function signInLockout(): SignInLockoutService {
  return new SignInLockoutService({
    state: new PrismaLockoutState(prisma),
    policy: lockoutPolicies,
    identity: new PrismaLockoutIdentity(prisma),
    evidence: new AuditLogLockoutEvidence(prisma),
    // Stated once, here, like every other environment read this root owns.
    hashIdentifier: keyedIdentifierHasher(env.NEXTAUTH_SECRET),
    now: () => new Date(),
  });
}

export function sessionBound(): SessionBoundService {
  return new SessionBoundService({
    policy: sessionBoundPolicies,
    activity: new PrismaSessionActivity(prisma),
    // Through the revocation service rather than a delete, because the row is
    // only half of a session — the cached copy would keep answering for up to
    // thirty days, and a session refused in one place and honoured in another
    // has not ended.
    ending: new RevocationSessionEnd(() => sessionRevocation()),
    now: () => new Date(),
  });
}

/**
 * The sign-in security SETTINGS surface's four stores (`signInSecurity.ts`),
 * distinct from `lockoutPolicies` / `sessionBoundPolicies` above: those
 * answer the strictest rule across an installation or a person's
 * memberships, and these answer one organization's own saved values, its
 * members' sessions, its membership, and where a release is put on the
 * record. Composed per call like every other write surface here.
 */
export function signInSecuritySettings(): PrismaSignInSecuritySettings {
  return new PrismaSignInSecuritySettings(prisma);
}

export function signInSecuritySessions(): PrismaOrganizationSessions {
  return new PrismaOrganizationSessions(prisma);
}

export function signInSecurityMembership(): PrismaOrganizationMembership {
  return new PrismaOrganizationMembership(prisma);
}

export function signInSecurityReleaseEvidence(): AuditLogSignInSecurityReleaseEvidence {
  return new AuditLogSignInSecurityReleaseEvidence(prisma);
}

/**
 * A connection's raw event history (ADR-117 SS5, D04) — the log itself,
 * read as a sequence. Both the organization's own authentication page and
 * the back office read through this one factory; only the caller and its
 * organization scoping differ.
 */
export function ssoConnectionHistory(): SsoConnectionHistoryService {
  return new SsoConnectionHistoryService({
    history: new EventLogSsoConnectionHistoryRepository(),
  });
}

/** The D04 grandfather, composed and registered.
 *
 *  `registeredMigrations()` declares it beside the AuthzEngine migration, so
 *  it runs on every organization-rooted path — see
 *  `specs/migration/system-migrations-runner.feature`, "The D04 connection
 *  grandfather migration is declared in the shared registry". This block used
 *  to say it was deliberately NOT registered and ran for nobody, which stopped
 *  being true when the registration landed and stayed here saying so.
 *
 *  Its proof reads through the two ROUTING ports rather than the projection
 *  directly — a proof that asked the store instead of the port would pass
 *  while the port that actually decides sign-in was miswired. */
export function connectionGrandfatherMigration(): IdentitySsoConnectionGrandfatherMigration {
  return new IdentitySsoConnectionGrandfatherMigration(
    new SsoConnectionGrandfatherService({
      connections: ssoConnections(),
      legacy: new PrismaLegacySsoOrganizationRepository(prisma),
      legacyRouting: legacySsoDomainRouting,
      connectionRouting: ssoConnectionDomainRouting,
      idpMetadataFor: ({ ssoProvider }) => ({
        // The legacy columns carry a provider NAME and nothing else: the
        // endpoints and credentials are the deployment's own env, which is
        // why grandfathered metadata is a reference to the mounted provider
        // rather than an invented issuer. D05's onboarding fills the rest in
        // when a human next edits the connection.
        issuer: null,
        providerId: ssoProvider,
        clientIdRef: null,
        secretRef: null,
        certRefs: [],
      }),
    }),
  );
}

/**
 * The identifier a password sign-up owes (ADR-117 §6), composed per call like
 * every other identity write surface — the ledger it commits through resolves
 * the pipeline handle lazily, so it must not be built at module load.
 */
export function signUpIdentifier(): SignUpIdentifierService {
  return new SignUpIdentifierService(identityService());
}

/**
 * Sign-up's address confirmation (D13, ADR-117 §6). Composed per call like
 * the write surface above: it reaches the mailer, and the mailer is the one
 * dependency a test routinely replaces.
 */
export function signUpVerification(): SignUpVerificationService {
  return new SignUpVerificationService({
    tokens: new PrismaSignUpVerificationTokenStore(prisma),
    directory: new PrismaSignUpAccountDirectory(prisma),
    mailer: {
      sendVerificationLink: ({ email, verificationUrl }) =>
        sendSignUpVerificationEmail({ email, verificationUrl }),
    },
    buildVerificationUrl: ({ token }) => buildSignUpVerificationUrl(token),
  });
}

/**
 * The reap that releases address locks no live identifier backs — a required
 * companion to the lock, not optional hygiene (ADR-116 §6).
 */
export function identityAddressLockReaper(): IdentityAddressLockReaperService {
  return new IdentityAddressLockReaperService({
    reservations: identityReservations,
  });
}

/**
 * better-auth's whole `database:` entry (ADR-116 §1): the identity storage
 * adapter, composed here like every other identity collaborator.
 *
 * The legacy branch is better-auth's own published Prisma engine rather than
 * a re-implementation, so an unlatched user's storage traffic is
 * byte-for-byte what it has always been. The gate stays closed for each user
 * until their automatic backfill finalizes.
 *
 * Built once, at module load, because `betterAuth()` is: the ceremonies it
 * carries resolve the pipeline handle lazily, so an adapter composed before
 * the App exists still appends once one does.
 */
const identityStorage = createIdentityStorageAdapter({
  legacyEngine: prismaAdapter(prisma, { provider: "postgresql" }),
  // The adapter's one real transaction, which `@better-auth/sso` requires
  // before it will resolve a user at all. It lives in its own adapter file
  // rather than inline here because opening a transaction is a query, and
  // this composition root is explicitly not exempt from that rule — see the
  // file's own docblock for what the transaction does and does not span.
  postgresTransaction: postgresTransactionOver(prisma),
  passkeyRemoval: PrismaPasskeyRemovalRepository.create({
    prisma,
    routesToIdentity: routesToIdentityBranch,
  }),
  accounts: identityAccounts,
  resolution: identityResolution,
  connectionIssuers: new PrismaSsoConnectionIssuers(prisma),
  ceremonies: identityCeremonies(),
  isUserOnIdentityWrites: isLatched,
  isAnyoneOnIdentityWrites: isAnyoneLatched,
  providerConfig: ssoProviderConfigCipher,
});

export function identityStorageAdapter(): AdapterFactory<BetterAuthOptions> {
  return identityStorage;
}

const provisionedSsoUsers = PrismaScimSsoUsers.create(
  identityStorageTransactions,
);

export function ssoProvisionedUsers(): PrismaScimSsoUsers {
  return provisionedSsoUsers;
}

/**
 * The better-auth boundary tier (ADR-129): the plugins, the guards and the
 * session minter, composed here like every other identity collaborator so
 * none of them opens the database itself.
 *
 * EVERY INSTANCE IS BUILT INSIDE ITS FACTORY, not at module scope, and that
 * is load-bearing rather than a style. These classes live under
 * `server/better-auth/`, whose modules import this file back for their thin
 * exports — a genuine cycle, and whichever side loads first the other's
 * classes are still in their temporal dead zone while this module's body
 * runs. Constructing one here eagerly would throw at import time, in the
 * process that boots better-auth.
 */

/** Opening the first session of an account's life, and setting its cookie. */
export function sessionMinter(): BetterAuthSessionMinter {
  return new BetterAuthSessionMinter();
}

/** Request-scoped SSO origin resolution reads the selected connection fresh. */
let registeredIssuersInstance: RegisteredIssuers | null = null;

export function ssoRegisteredIssuers(): RegisteredIssuers {
  registeredIssuersInstance ??= new RegisteredIssuers({
    issuers: new PrismaSsoConnectionIssuers(prisma),
  });
  return registeredIssuersInstance;
}

/**
 * Spending the sign-up confirmation link (ADR-117 §6).
 *
 * The verification service is resolved per call rather than captured, for the
 * reason {@link signUpVerification} is composed per call: it reaches the
 * mailer, and the mailer is the one dependency a test routinely replaces.
 */
export function signUpConfirmationEndpoint(): SignUpConfirmationEndpoint {
  return new SignUpConfirmationEndpoint({
    verification: {
      completeVerification: ({ token }) =>
        signUpVerification().completeVerification({ token }),
    },
    users: {
      findUserIdByEmail: ({ email }) =>
        identityUsers.findUserIdByEmail({ normalizedValue: email }),
    },
    minter: sessionMinter(),
  });
}

/**
 * Signing somebody in with the password they just set (D13).
 *
 * A memoized singleton, because the instance owns the request scope the
 * endpoint's callback writes into and the after-hook reads back: two
 * instances would be two scopes, and the hook would find every reset
 * unattributed.
 */
let passwordResetSessionBridgeInstance: PasswordResetSessionBridge | null =
  null;

export function passwordResetSessionBridge(): PasswordResetSessionBridge {
  passwordResetSessionBridgeInstance ??= new PasswordResetSessionBridge({
    minter: sessionMinter(),
  });
  return passwordResetSessionBridgeInstance;
}

/** Creating an account WITH a passkey, rather than adding one to an account. */
export function passkeySignUp(): PasskeySignUpRegistration {
  return new PasskeySignUpRegistration({
    eligibility: {
      isAllowed: async (email, method) => {
        const decision = await localSignUpDecision(email);
        return (
          decision.outcome === "enroll" &&
          decision.methodSet.some((candidate) => candidate.kind === method)
        );
      },
    },
    directory: identityUsers,
    accounts: {
      createPasskeyUser: ({ email, claimHash }) =>
        credentialAccounts().openPasskeyAccount({ email, claimHash }),
    },
    verification: {
      validateAddressProof: ({ token, email }) =>
        signUpVerification().validateAddressProof({ token, email }),
      claimAddressProof: ({ token, email }) =>
        signUpVerification().claimAddressProof({ token, email }),
    },
  });
}

/** Whether a removal would leave somebody unable to sign in (ADR-119). */
export function lastWayIn(): LastWayInService {
  return new LastWayInService({
    records: new PrismaLastWayInRepository(prisma, routesToIdentityBranch),
  });
}

/** The same answer, as the refusal better-auth's `before` hook raises. */
export function lastWayInGuard(): LastWayInGuard {
  return new LastWayInGuard({ lastWayIn: lastWayIn() });
}

/**
 * bcrypt's cost for every password the credential service writes.
 *
 * It was a literal at each of the three sites that wrote one — registering,
 * setting a first password and changing one, all of them in the user router —
 * so raising it meant finding all three, and a site that was missed would go
 * on writing weaker hashes than the ones beside it with nothing to show for
 * it. better-auth's own legacy-hash bridge is the fourth door a password
 * arrives through, and it is HANDED this number (ADR-129) rather than
 * spelling one of its own, so the whole platform hashes at one cost.
 */
export const PASSWORD_HASH_ROUNDS = 10;

/**
 * An account's own credentials (ADR-129): opening one with a password or a
 * passkey, listing and unlinking the ways in, and setting, changing or simply
 * having a password.
 *
 * Composed per call like the write surfaces around it — the identifier attach
 * it states goes through a ledger that resolves the pipeline handle lazily, so
 * it must not be built at module load.
 *
 * bcrypt, Auth0's Management API and the analytics milestone arrive as
 * closures for the same reason every other environment-facing dependency here
 * does: the service states WHEN a password is hashed and WHO gets a sign-up
 * counted, and this root states what does the hashing and the counting.
 */
export function credentialAccounts(): CredentialAccountService {
  const legacyRecords = new PrismaCredentialAccountRepository(prisma);
  const identityWriter = IdentityAccountWriter.create({
    accounts: identityAccounts,
    ceremonies: identityCeremonies(),
  });

  return new CredentialAccountService({
    records: CredentialAccountStorageAdapter.create({
      legacy: legacyRecords,
      identityAccounts,
      identityWriter,
      routesToIdentity: routesToIdentityBranch,
      newAccountId: nanoid,
      now: () => new Date(),
    }),
    // The one case-insensitive address lookup, shared with the identity
    // guards rather than re-spelled for registration (ADR-129 rule 4).
    directory: identityUsers,
    passwords: {
      hash: ({ password }) => hash(password, PASSWORD_HASH_ROUNDS),
      matches: ({ password, hash: stored }) => compare(password, stored),
    },
    federated: {
      changePassword: ({
        email,
        federatedUserId,
        currentPassword,
        newPassword,
      }) =>
        changeAuth0Password({
          email,
          auth0UserId: federatedUserId,
          currentPassword,
          newPassword,
        }),
    },
    identifiers: signUpIdentifier(),
    sessions: sessionRevocation(),
    milestones: {
      signedUp: ({ userId }) =>
        trackServerEvent({ userId, event: "signed_up" }),
    },
  });
}

/**
 * Whether an assertion from a customer's identity provider may become a
 * session (ADR-129), over the connection projection and the membership rows.
 *
 * Composed per call like every other read surface here: it holds no state,
 * and better-auth reaches it from a plugin callback rather than at module
 * load.
 */
export function ssoAssertion(): SsoAssertionService {
  return new SsoAssertionService({
    connections: new PrismaSsoConnectionReadRepository(prisma),
    memberships: new PrismaSsoMembershipRepository(prisma),
    breakGlass: {
      // Asked only for a connection that is not live yet and has proved the
      // asserted domain, so this read never happens on an ordinary sign-in.
      // `breakGlassIsLive` is the same predicate activation counts with, so
      // the gate and the go-live checklist cannot disagree about whether a
      // way back in exists.
      hasLiveBreakGlass: async ({ organizationId }) => {
        const bindings = await new PrismaSsoBreakGlassRepository(
          prisma,
        ).findAllForOrganization({
          organizationId,
        });
        const nowMs = Date.now();
        return bindings.some((binding) => breakGlassIsLive({ binding, nowMs }));
      },
    },
  });
}

/**
 * What happens to somebody arriving through a single sign-on connection, and
 * to somebody whose address domain a legacy `Organization.ssoDomain` claims
 * (ADR-129).
 *
 * The join-request service and the grant writer are reached through closures
 * rather than captured: both resolve the pipeline handle when they run, so a
 * service composed before the App exists still appends once one does.
 */
/**
 * Where a pre-activation arrival stands — the administrator's own test
 * sign-in, on every setup there has ever been.
 *
 * Reads only. It shares the connection and membership repositories with
 * `ssoArrival()` on purpose: the two answer the same question from opposite
 * ends, and a separate reading of "live" or "member" is how they would come
 * to disagree about who is stranded.
 */
export function ssoTestArrival(): SsoTestArrivalService {
  return new SsoTestArrivalService({
    accounts: ssoAccountFacts,
    connections: new PrismaSsoConnectionReadRepository(prisma),
    memberships: new PrismaSsoMembershipRepository(prisma),
  });
}

export function ssoArrival(): SsoArrivalService {
  return new SsoArrivalService({
    migrations: systemMigrationsService,
    connections: new PrismaSsoConnectionReadRepository(prisma),
    memberships: new PrismaSsoMembershipRepository(prisma),
    invites: {
      // Find-then-apply is one decision, so it is one port call: an invite
      // that exists is the invite that wins, and its role and team
      // assignments replace the default membership entirely.
      applyPendingInvite: async ({ userId, organizationId, email }) => {
        const invites = InviteService.create(prisma);
        const pending = await invites.findPendingByOrgAndEmail({
          organizationId,
          email,
        });
        if (!pending) return null;
        await invites.applyInvite({ userId, invite: pending });
        return { inviteId: pending.id };
      },
    },
    joinRequests: {
      requestFromSsoArrival: (args) =>
        joinRequestsService().requestFromSsoArrival(args),
    },
    grants: {
      attachBindings: (args) => grantsLedgerWriter().attachBindings(args),
    },
    notifications: {
      joinedAutomatically: (args) =>
        organizationJoinNotifications().joinedAutomatically(args),
      announceSignup: (args) => {
        void getApp()
          .notifications.sendSlackSignupEvent(args)
          .catch(captureException);
      },
      startNurturing: (args) => fireSsoAutoAddNurturingCalls(args),
    },
  });
}

/**
 * better-auth's whole `databaseHooks:` entry as one class (ADR-129).
 *
 * The hooks decide nothing about the data: each one translates better-auth's
 * row into a call on a service above, which is what makes "a hook that wants
 * a row has nothing to ask but a service" a property of the type rather than
 * a review comment.
 */
export function databaseHooks(): BetterAuthDatabaseHooks {
  return new BetterAuthDatabaseHooks({
    users: identityUsers,
    organizations: new PrismaLegacySsoOrganizationRepository(prisma),
    connectionRouting: { connectionGoverning: connectionGoverningAddress },
    accounts: ssoAccountFacts,
    ssoArrival: ssoArrival(),
    ssoMigration: new PrismaSsoMigrationCallbackPolicy(
      prisma,
      newIdentityCommandId,
      verifiedCallbackProviderAssertions,
    ),
    federationAllowed: () => platformSSOAllowed(),
    signInEvidence: signInLinkEvidence(),
    analytics: {
      // The same distinct id posthog-js identifies with client-side, so this
      // server event joins the browser person.
      trackSignUp: ({ userId }) =>
        trackServerEvent({ userId, event: "signed_up" }),
    },
    nurturing: {
      trackActivity: (args) => fireActivityTrackingNurturing(args),
      syncProfile: (args) => ensureUserSyncedToCio(args),
    },
  });
}

/**
 * The three compositions that used to live in satellite `*-runtime.ts` files
 * beside this one, and now do not (ADR-129).
 *
 * They were split off for one structural reason: two of them reach
 * `~/server/better-auth`, and `~/server/better-auth` builds its plugin list
 * and its storage adapter out of THIS file at module load. A static edge from
 * here to those adapters closed that loop, and a loop between two modules that
 * both work at load time crashes whichever side is entered second. The edge
 * now runs the other way: the boundary is HANDED the instance holder below and
 * fills it once `betterAuth()` has returned, so nothing in this tree names the
 * better-auth module as a value and the composition root can be one file.
 *
 * Everything here is composed PER CALL, like the write surfaces above: the
 * ledger writers resolve the pipeline handle lazily, so a service built before
 * the App exists still appends once one does.
 */

/**
 * The one better-auth instance, as the two adapters below reach it. Filled by
 * `server/better-auth/index.ts` the moment the instance exists; resolving it
 * earlier is a wiring fault and throws (`better-auth-instance.adapter.ts`).
 */
const betterAuthHandle = new BetterAuthInstanceHandle();

export function betterAuthInstance(): BetterAuthInstanceHandle {
  return betterAuthHandle;
}

/**
 * The proposal log, read. One instance: it holds no request state, and its
 * event-store handle is resolved per read anyway.
 */
const identityLinkProposalLog = new EventLogIdentityRepository();

/**
 * Deciding a waiting sign-in (ADR-117 §3). The ONLY way a proposal is
 * decided — nothing writes a decision anywhere else, because there is
 * nowhere else to write one: a decision is a fact on the person's history.
 */
export function linkProposals(): LinkProposalService {
  return new LinkProposalService({
    guards: new LinkProposalGuards({ proposals: identityLinkProposalLog }),
    // The shared factory, not a second construction: the store also releases
    // the address locks a user stops holding, and it needs the reservation
    // repository to do it.
    ledger: new IdentityLedgerWriter({
      projectionStore: identityProjectionStore(),
      heads: identityHeads,
    }),
    proposals: identityLinkProposalLog,
    directory: new BetterAuthLinkProposalDirectory({
      prisma,
      auth: betterAuthHandle,
    }),
  });
}

/** The platform operator's identity lookup (D05). */
export function identityLookup(): IdentityLookupService {
  return new IdentityLookupService({
    reads: new PrismaIdentityLookupRepository(prisma),
    history: identityLinkProposalLog,
    proposals: identityLinkProposalLog,
    router: signInRouter,
    identity: identityService,
    links: linkProposals,
    sessions: new BetterAuthOperatorSessions(sessionRevocation()),
    invitations: new InviteServiceOperatorInvitations(prisma),
  });
}

function scimReconciliationReads(): PrismaScimReconciliationRepository {
  return new PrismaScimReconciliationRepository(prisma);
}

function scimLifecycle(): ScimSyncLifecycle {
  return scimSyncLifecycle(prisma);
}

/**
 * The re-drive's apply arm: the same deprovision service the SCIM request
 * path uses, so a re-driven removal runs the identical proof a directory's
 * own removal does. A second implementation "for operators" would be a
 * second set of postconditions.
 */
function scimRedriveApply(): ScimRedriveApplyPort {
  return new ScimDeprovisionService({
    grants: grantsService(),
    syncLifecycle: scimLifecycle(),
  });
}

/** The organization's own read of its directory sync (ADR-122). */
export function scimReconciliation(): ScimReconciliationService {
  return new ScimReconciliationService({
    reads: scimReconciliationReads(),
    // The log, read as a sequence (ADR-126). It resolves the App's event
    // store lazily for the same reason everything else here is built per
    // call: there may not be an App yet at module scope.
    activity: new EventLogScimSyncActivityRepository(),
    // The requests table (ADR-126). The service holds a port rather than the
    // enterprise service itself, so the organization view never learns where
    // the evidence is stored to render it.
    requests: ScimRequestLogService.create(prisma),
  });
}

/** The cross-customer operator surface, and its one guarded write. */
export function scimOversight(): ScimOversightService {
  return new ScimOversightService({
    reads: scimReconciliationReads(),
    lifecycle: scimLifecycle,
    deprovision: scimRedriveApply,
  });
}

/**
 * The account side of two-step verification, composed (D06).
 *
 * It reaches the two-factor plugin's endpoints, which live on the better-auth
 * instance — the second of the two compositions the instance holder above
 * exists for.
 */
export function twoStepVerification(): TwoStepVerificationService {
  return new TwoStepVerificationService({
    account: new PrismaTwoStepAccount(prisma),
    protocol: new BetterAuthTwoStepProtocol(betterAuthHandle),
    offered: deploymentOffersTwoStepVerification,
  });
}

/**
 * What better-auth's secondary storage is composed from: whether this
 * deployment has one at all, and the connection a callback finds when it runs
 * (`better-auth/config/secondary-storage.ts` is the storage itself).
 *
 * WHETHER to configure it is a pure question about *configuration*, so it is
 * answered from env rather than from a live client (ADR-093), and it is
 * answered here rather than in the config module because the answer costs a
 * `RedisConfigService` — a construction that belongs to the composition root
 * like every other (ADR-129 rule 3).
 *
 * `BUILD_TIME` joins `SKIP_REDIS` in the skip signal: a build or a test run has
 * env pointing at a Redis it must not adopt as a session store.
 */
export function secondaryStorage(): SecondaryStorageDeps {
  return {
    configured: new RedisConfigService().isConfigured({
      url: env.REDIS_URL,
      clusterEndpoints: env.REDIS_CLUSTER_ENDPOINTS,
      skip: env.SKIP_REDIS || !!process.env.BUILD_TIME,
    }),
    connection: () => tryGetApp()?.redis ?? null,
  };
}
