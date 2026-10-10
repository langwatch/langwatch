import { AuditLogApi } from "@langwatch/audit-log-contract";
import { SYSTEM_ACTORS } from "@langwatch/authorization";
import { AuthzApi } from "@langwatch/authz-contract";
import { LicensingApi } from "@langwatch/enterprise-licensing-contract";
import { ScimApi } from "@langwatch/enterprise-scim-contract";
import { EntitlementApi, isEnterpriseTier } from "@langwatch/entitlement-contract";
import type { EventingParticipation, OwnEventStore } from "@langwatch/eventing";
import {
  type AccountIdentifier,
  type EmailIdentifierAdded,
  IdentityApi,
  IdentityCapabilityUnavailableError,
  identityConfig,
  type IdentityEmailResolution,
  JOIN_REQUEST_PIPELINE_NAME,
  SSO_CONNECTION_PIPELINE_NAME,
  type IdentityLookupAnswer,
  type IdentityLookupApi,
  type IdentityLookupOperator,
  type IdentityReservationsApi,
  type LookupDomainClaim,
  type VerifiedUserDomain,
  type LookupInvitationExpiry,
  type LookupOperatorActivityRow,
  type LookupPersonDetail,
  type IdentityServerConfig,
  type MethodsLastUsed,
  type RoutingDecision,
  type SessionClaims,
  type SessionClaimsMintInput,
  SignInMethodPolicyService,
  type OrganizationMemberFactor,
  type OrganizationMfaRequirement,
  type OrganizationMfaRequirementChange,
  type OrganizationMfaStanding,
  type RequestHeaderRecord,
  type TwoStepAccountStanding,
  type TwoStepDisabled,
  type TwoStepVerificationApi,
  type VerifiedEmailsResolution,
  type IdentityStorageAdapterInput,
  type IdentityCeremoniesApi,
} from "@langwatch/identity-contract";
import { NotificationService } from "@langwatch/notification-contract";
/**
 * The identity feature's application: guards, ledger writer, backfill,
 * newborn sweep, join-request/SSO-connection/directory-sync guards — every
 * capability crossing a package boundary today (ADR-101, 115, 116, 117).
 */
import { createLogger } from "@langwatch/observability";
import { OrganizationApi } from "@langwatch/organization-contract";
import type { FeatureSetup } from "@langwatch/process";
import { internalSlackSignupsWebhook } from "@langwatch/secrets";
import type { SystemMigration } from "@langwatch/system-migrations";
import { Temporal, nowInstant } from "@langwatch/time";
import { UserApi } from "@langwatch/user-contract";
import type { BetterAuthOptions } from "better-auth";
import type { AdapterFactory } from "better-auth/adapters";

import { systemHostAddresses } from "../channels/dns.host-addresses.channel.ts";
import type { IdentityChannels } from "../channels/identity.channels.ts";
import { ConnectedIdentityEventing } from "../eventing/identity-command-senders.store.ts";
import { IdentityEventStores } from "../eventing/identity-event-stores.store.ts";
import { IdentityLedgerStore } from "../eventing/identity-ledger.store.ts";
import {
  composeIdentityPipeline,
  type IdentityPipeline,
} from "../eventing/user-identity.pipeline.ts";
import { JoinRequestLedgerStore } from "../features/join-request/eventing/join-request-ledger.store.ts";
import {
  composeJoinRequestPipeline,
  type JoinRequestPipeline,
} from "../features/join-request/eventing/join-request.pipeline.ts";
import type {
  JoinMembership,
  JoinOfferDismissals,
  JoinRequestsServiceDeps,
  JoinSetting,
  JoinSettingAudit,
} from "../features/join-request/rules/join-requests-contract.rules.ts";
import { JoinAdmissionsService } from "../features/join-request/services/join-admissions.service.ts";
import { JoinRequestDoorService } from "../features/join-request/services/join-request-door.service.ts";
import { JoinRequestGuardsService } from "../features/join-request/services/join-request-guards.service.ts";
import { JoinRequestNotifierService } from "../features/join-request/services/join-request-notifier.service.ts";
import { JoinRequestService } from "../features/join-request/services/join-request.service.ts";
import { JoinRequestsService } from "../features/join-request/services/join-requests.service.ts";
import { MfaGuardsService } from "../features/mfa/services/mfa-guards.service.ts";
import { OrganizationMfaNotifierService } from "../features/mfa/services/organization-mfa-notifier.service.ts";
import { OrganizationMfaService } from "../features/mfa/services/organization-mfa.service.ts";
import { TwoStepAccountService } from "../features/mfa/services/two-step-account.service.ts";
import { SignUpIdentifierService } from "../features/signin/services/sign-up-identifier.service.ts";
import { SignInAccountLookupService } from "../features/signin/services/signin-account-lookup.service.ts";
import { SignInRouterService } from "../features/signin/services/signin-router.service.ts";
import { SignupAnnouncementService } from "../features/signin/services/signup-announcement.service.ts";
import {
  breakGlassHolderEligibility,
  passwordDoorMounted,
} from "../features/sso-arrival/rules/break-glass-eligibility.rules.ts";
import type { SsoArrivalMemberships } from "../features/sso-arrival/rules/sso-arrival-contract.rules.ts";
import { ssoMethodDialWith } from "../features/sso-arrival/rules/sso-method-dial.rules.ts";
import { InProcessBreakGlassLimiterService } from "../features/sso-arrival/services/in-process-break-glass-limiter.service.ts";
import { LegacySsoDomainRoutingService } from "../features/sso-arrival/services/legacy-sso-domain-routing.service.ts";
import { SsoArrivalAdoptionService } from "../features/sso-arrival/services/sso-arrival-adoption.service.ts";
import { SsoArrivalService } from "../features/sso-arrival/services/sso-arrival.service.ts";
import { SsoAssertionService } from "../features/sso-arrival/services/sso-assertion.service.ts";
import { SsoAuthenticationActivityService } from "../features/sso-arrival/services/sso-authentication-activity.service.ts";
import { SsoBreakGlassRecoveryService } from "../features/sso-arrival/services/sso-break-glass-recovery.service.ts";
import {
  RequiresLocalDoorAndBinding,
  SsoBreakGlassService,
  type SsoBreakGlassDirectory,
} from "../features/sso-arrival/services/sso-break-glass.service.ts";
import { SsoIssuerDirectoryService } from "../features/sso-arrival/services/sso-issuer-directory.service.ts";
import { SsoIssuerEndpointOriginsService } from "../features/sso-arrival/services/sso-issuer-endpoint-origins.service.ts";
import {
  SsoLegacyIdentityRetirementService,
  type SsoLegacyAccessRetirement,
  type SsoRetirementMemberships,
} from "../features/sso-arrival/services/sso-legacy-identity-retirement.service.ts";
import { SsoMigrationCallbackService } from "../features/sso-arrival/services/sso-migration-callback.service.ts";
import { SsoMigrationFinalizationService } from "../features/sso-arrival/services/sso-migration-finalization.service.ts";
import { SsoMigrationProgressService } from "../features/sso-arrival/services/sso-migration-progress.service.ts";
import {
  SsoTestArrivalService,
  type SsoTestArrivalAccounts,
  type SsoTestArrivalMemberships,
} from "../features/sso-arrival/services/sso-test-arrival.service.ts";
import { SsoUserResolutionService } from "../features/sso-arrival/services/sso-user-resolution.service.ts";
import {
  composeSsoConnectionGraph,
  type SsoConnectionPipeline,
} from "../features/sso-connection/eventing/sso-connection.pipeline.ts";
import { newSsoBreakGlassBindingId } from "../features/sso-connection/rules/sso-connection-id.rules.ts";
import { OrganizationSsoConnectionsService } from "../features/sso-connection/services/organization-sso-connections.service.ts";
import { SsoConnectionAdminService } from "../features/sso-connection/services/sso-connection-admin.service.ts";
import { SsoConnectionDirectoryMoveService } from "../features/sso-connection/services/sso-connection-directory-move.service.ts";
import { SsoConnectionGrandfatherService } from "../features/sso-connection/services/sso-connection-grandfather.service.ts";
import type { SsoConnectionGuardsService } from "../features/sso-connection/services/sso-connection-guards.service.ts";
import { SsoConnectionHistoryService } from "../features/sso-connection/services/sso-connection-history.service.ts";
import { SsoConnectionRoutingService } from "../features/sso-connection/services/sso-connection-routing.service.ts";
import type { SsoConnectionService } from "../features/sso-connection/services/sso-connection.service.ts";
import { SsoEngineProviderService } from "../features/sso-connection/services/sso-engine-provider.service.ts";
import { SsoIdpCredentialsService } from "../features/sso-connection/services/sso-idp-credentials.service.ts";
import { SsoIdpRegistrationService } from "../features/sso-connection/services/sso-idp-registration.service.ts";
import { SsoRegistrantReadsService } from "../features/sso-connection/services/sso-registrant-reads.service.ts";
import { SsoSetupCommandsService } from "../features/sso-connection/services/sso-setup-commands.service.ts";
import { SsoSetupService } from "../features/sso-connection/services/sso-setup.service.ts";
import { IdentityConnectionGrandfatherMigrationService } from "../features/sso-connection/services/system-migration-identity-connection-grandfather.service.ts";
import { SsoDomainCeremonyService } from "../features/sso-domain/services/sso-domain-ceremony.service.ts";
import { SsoDomainOwnershipBackfillService } from "../features/sso-domain/services/sso-domain-ownership-backfill.service.ts";
import { SsoDomainReproofService } from "../features/sso-domain/services/sso-domain-reproof.service.ts";
import { SsoDomainOwnershipMigrationService } from "../features/sso-domain/services/system-migration-sso-domain-ownership.service.ts";
import type { IdentityRateLimitRepository } from "../repositories/identity-rate-limit.repository.ts";
import type { IdentityRepositories } from "../repositories/identity.repositories.ts";
import { LocalDoorBreakGlassBindingRepository } from "../repositories/local/local.door-break-glass-binding.repository.ts";
import { newIdentityCommandId } from "../rules/identity-command-id.rules.ts";
import { AccountIdentifiersService } from "../services/account-identifiers.service.ts";
import { BetterAuthAccountBranchService } from "../services/better-auth-account-branch.service.ts";
import { BetterAuthCeremonyBridgeService } from "../services/better-auth-ceremony-bridge.service.ts";
import { IdentityCeremoniesService } from "../services/better-auth-identity-ceremonies.service.ts";
import { BetterAuthIdentityRoutingService } from "../services/better-auth-identity-routing.service.ts";
import { BetterAuthIdentityStorageService } from "../services/better-auth-identity-storage.service.ts";
import { BetterAuthUserBranchService } from "../services/better-auth-user-branch.service.ts";
import { CryptoIdentifierIdentityService } from "../services/crypto-identifier-identity.service.ts";
import { IdentityBackfillPlanService } from "../services/identity-backfill-plan.service.ts";
import { IdentityBackfillService } from "../services/identity-backfill.service.ts";
import { IdentityEmailService } from "../services/identity-email.service.ts";
import { IdentityGuardsService } from "../services/identity-guards.service.ts";
import { IdentityLookupService } from "../services/identity-lookup.service.ts";
import {
  IDENTITY_NEWBORN_ABANDONED_AFTER_MS,
  IdentityNewbornReconciliationService,
} from "../services/identity-newborn-reconciliation.service.ts";
import { IdentitySecretCarryService } from "../services/identity-secret-carry.service.ts";
import { IdentityService } from "../services/identity.service.ts";
import { LinkProposalGuardsService } from "../services/link-proposal-guards.service.ts";
import { LinkProposalService } from "../services/link-proposal.service.ts";
import { MicrosoftAccountRekeyService } from "../services/microsoft-account-rekey.service.ts";
import {
  CachedIdentityLatchService,
  IDENTITY_LATCH_CACHE_MAX_USERS,
  IDENTITY_LATCH_CACHE_TTL_MS,
} from "../services/per-subject-cached-latch.service.ts";
import { SessionClaimsService } from "../services/session-claims.service.ts";
import { IdentityIdentifierBackfillMigrationService } from "../services/system-migration-identity-identifier-backfill.service.ts";
import { IdentitySecretHealMigrationService } from "../services/system-migration-identity-secret-heal.service.ts";
import { VerificationCeremonyService } from "../services/verification-ceremony.service.ts";
import type { JoinRequestDoorApi } from "../transport/join-request.trpc.ts";
/**
 * The boundary `reservations().reapOrphans()` call takes no args, so it bounds
 * itself per pass the same way `IdentityNewbornReconciliationService`'s own
 * internal reap of this exact repository call does.
 */
const RESERVATIONS_REAP_LIMIT_PER_PASS = 200;
type IdentitySetup = FeatureSetup<typeof IdentityModule.dependencies, IdentityServerConfig> &
  Readonly<{ repositories: IdentityRepositories; channels: IdentityChannels }>;

type IdentityAppParts = {
  emails: IdentityEmailService;
  ceremonies: IdentityCeremoniesApi;
  storage: (input: IdentityStorageAdapterInput) => AdapterFactory<BetterAuthOptions>;
  identityGuards: IdentityGuardsService;
  mfaGuards: MfaGuardsService;
  reservations: IdentityRepositories["reservations"];
  identity: IdentityService;
  verification: VerificationCeremonyService;
  accountIdentifiers: AccountIdentifiersService;
  sessionClaims: SessionClaimsService;
  microsoftAccountRekey: MicrosoftAccountRekeyService;
  newbornSweep: IdentityNewbornReconciliationService;
  signUpIdentifiers: SignUpIdentifierService;
  backfill: IdentityBackfillService;
  secrets: IdentitySecretCarryService;
  ssoDomainOwnershipBackfill: SsoDomainOwnershipBackfillService;
  ssoConnectionGrandfather: SsoConnectionGrandfatherService | null;
  joinRequestGuards: JoinRequestGuardsService;
  ssoConnections: SsoConnectionService | null;
  ssoConnectionGuards: SsoConnectionGuardsService;
  ssoAdmin: SsoConnectionAdminService | null;
  ssoConnectionHistory: SsoConnectionHistoryService;
  ssoConnectionReads: OrganizationSsoConnectionsService;
  ssoIssuers: SsoIssuerDirectoryService;
  ssoDomainCeremony: SsoDomainCeremonyService | null;
  ssoDomainReproof: SsoDomainReproofService | null;
  ssoAssertion: SsoAssertionService;
  ssoArrival: SsoArrivalService;
  ssoTestArrival: SsoTestArrivalService;
  joinAdmissions: JoinAdmissionsService;
  joinRequests: JoinRequestsService;
  joinRequestDoor: JoinRequestDoorService;
  ssoActivity: SsoAuthenticationActivityService;
  ssoMigrationCallbacks: SsoMigrationCallbackService;
  ssoBreakGlass: SsoBreakGlassService;
  ssoSetup: SsoSetupService;
  ssoSetupCommands: SsoSetupCommandsService | null;
  lookup: IdentityLookupService;
  twoStepAccounts: TwoStepAccountService;
  organizationMfa: OrganizationMfaService;
  signInRouter: SignInRouterService;
  pipelines: IdentityPipelineBuilders;
};

/** The three pipelines' definitions over the module's own rows, in every role (2026-09-27). */
type IdentityPipelineBuilders = {
  eventing: ConnectedIdentityEventing;
  /** Each pipeline's own event store, kept as the process builds it (record §7). */
  stores: IdentityEventStores;
  identity: () => IdentityPipeline;
  joinRequests: () => JoinRequestPipeline;
  ssoConnections: () => SsoConnectionPipeline;
};

/**
 * The membership half of an arrival, answered by the organization peer
 * (ADR-129). Identity never writes an `OrganizationUser` row itself; it asks
 * the module that owns one.
 */
function arrivalMemberships(organizations: OrganizationApi): SsoArrivalMemberships {
  return {
    isMember: (args) => organizations.isMember(args),
    createMembership: (args) => organizations.createMembership(args),
    applyPendingInvite: (args) => organizations.applyPendingInvite(args),
    /** Absent for an organization deleted between the decision and the join,
     *  which admits nobody. */
    findOrganization: async ({ organizationId }) => {
      const summary = await organizations.findProvisioningSummary(organizationId);
      return summary ? { id: summary.id, name: summary.name } : null;
    },
  };
}

/**
 * What a test arrival reads, and nothing that could provision: belonging
 * anywhere at all, and the organization a connection was being proved for.
 */
function testArrivalMemberships(organizations: OrganizationApi): SsoTestArrivalMemberships {
  return {
    hasAnyMembership: async ({ userId }) =>
      (await organizations.organizationIdsForMember({ userId })).length > 0,
    findOrganization: async ({ organizationId }) => {
      const summary = await organizations.findProvisioningSummary(organizationId);
      return summary ? { id: summary.id, name: summary.name } : null;
    },
  };
}

/** Which providers signed this person in, from the module that owns every
 *  `Account` row (ADR-129) — identity reads none of them itself. */
function testArrivalAccounts(reads: IdentityChannels["authReads"]): SsoTestArrivalAccounts {
  return { findAccountProvidersForUser: (args) => reads.findFederatedAccountProviders(args) };
}

/** The organization's own member rows, as the migration read asks for them:
 *  active members only, which is what `getAllMembers` already means. */
function migrationMemberships(organizations: OrganizationApi): SsoRetirementMemberships {
  return {
    listActiveMembers: async ({ organizationId }) => {
      const members = await organizations.getAllMembers({ organizationId });
      return members.map((member) => ({
        userId: member.id,
        name: member.name ?? null,
        email: member.email ?? null,
      }));
    },
    organizationIdsForMember: (args) => organizations.organizationIdsForMember(args),
  };
}

/** Who may hold a way back in, and what they are called: the organization's
 *  own administrators, asked for rather than queried (ADR-129). */
function breakGlassDirectory(organizations: OrganizationApi): SsoBreakGlassDirectory {
  return { findAdministrators: (args) => organizations.findAdministrators(args) };
}

/** Standing is the organization's answer; whether somebody holds a door that
 *  is not the identity provider is the module that owns the credential's. */
function breakGlassEligibility(
  organizations: OrganizationApi,
  users: UserApi,
): (args: { organizationId: string; userId: string }) => Promise<boolean> {
  return breakGlassHolderEligibility({
    isAdministrator: async ({ organizationId, userId }) =>
      (await organizations.findAdministrators({ organizationId })).some(
        (administrator) => administrator.userId === userId,
      ),
    holdsPassword: ({ userId }) => users.hasPassword({ id: userId }),
  });
}

/** Auth owns every `Account` row an identity provider minted, so what still
 *  lets somebody in through a retiring connection is its answer (ADR-129). */
function legacySsoAccess({
  reads,
  auth,
}: {
  reads: IdentityChannels["authReads"];
  auth: IdentityChannels["authCommands"];
}): SsoLegacyAccessRetirement {
  return {
    count: (args) => reads.countLegacySsoAccess(args),
    retire: (args) => auth.retireLegacySsoAccess(args),
  };
}

/** Membership is the organization's (ADR-129): a join lands through the arrival's door. */
function joinMemberships(organizations: OrganizationApi): JoinMembership {
  return {
    isMember: (args) => organizations.isMember(args),
    memberOrganizationIds: (args) => organizations.memberOrganizationIds(args),
    // The approving admin, or the policy that approved: the grant is audited to them.
    attachDefaultMembership: async ({
      userId,
      organizationId,
      commandId,
      approvedByUserId,
      role,
      origin,
    }) => {
      await organizations.createMembership({
        userId,
        organizationId,
        seat: role,
        origin,
        admittedBy: {
          actor: approvedByUserId
            ? { type: "user", id: approvedByUserId }
            : { type: "system", id: SYSTEM_ACTORS.joinRequests },
          commandId,
        },
      });
    },
  };
}

/** The joining setting lives in the organization's own columns; identity decides, it keeps. */
function joinSettings(organizations: OrganizationApi): JoinSetting {
  return {
    read: (args) => organizations.getJoinSetting(args),
    write: ({ organizationId, domainJoin, joinDomains, joinerRole }) =>
      organizations.saveJoinSetting({
        organizationId,
        setting: { domainJoin, joinDomains, joinerRole },
      }),
  };
}

/** A "no thanks" is a preference on the person, which the user module keeps. */
function joinOfferDismissals(users: UserApi): JoinOfferDismissals {
  return {
    dismissedDomains: ({ userId }) => users.findJoinOfferDismissedDomains({ id: userId }),
    dismiss: ({ userId, domain }) => users.dismissJoinOffer({ id: userId, domain }),
  };
}

/** The audit row main writes for a joining change: both values, and both domain lists. */
function joinSettingAudit(auditLog: AuditLogApi): JoinSettingAudit {
  return {
    joiningChanged: async ({ organizationId, actorUserId, change }) => {
      await auditLog.record({
        userId: actorUserId,
        organizationId,
        action: "organization.joining.changed",
        args: {
          from: change.previous,
          to: change.next,
          fromDomains: [...change.previousDomains],
          toDomains: [...change.nextDomains],
          fromJoinerRole: change.previousJoinerRole,
          toJoinerRole: change.nextJoinerRole,
        },
        targetKind: "organization",
        targetId: organizationId,
      });
    },
  };
}

/** The process's one counter, in the window and allowance the join throttles name. */
function joinRateLimit(limiter: IdentityRateLimitRepository): JoinRequestsServiceDeps["rateLimit"] {
  return async ({ key, windowSeconds, max }) => {
    const decision = await limiter.check(key, { requests: max, seconds: windowSeconds });
    const retryAfterMs = (decision.retryAfterSeconds ?? windowSeconds) * 1000;

    return { allowed: decision.allowed, resetAt: nowInstant().epochMilliseconds + retryAfterMs };
  };
}

export class IdentityModule
  implements IdentityApi, IdentityLookupApi, TwoStepVerificationApi, JoinRequestDoorApi
{
  static readonly contract = IdentityApi;
  static readonly config = identityConfig;
  /** The two peers an admission orchestrates: the module that owns
   *  membership rows, and the one that owns the pending-admission marker. */
  static readonly dependencies = {
    organizations: OrganizationApi,
    permissions: AuthzApi,
    /** Whether somebody holds a password is the module that owns it. */
    users: UserApi,
    /** Whether an organization's plan carries the who-can-join control. */
    entitlements: EntitlementApi,
    /** Where a changed joining setting is recorded for the customer. */
    auditLog: AuditLogApi,
    /** Whether this deployment's licence allows automatic joining. */
    licensing: LicensingApi,
    /** Where a finished SSO migration's directory sync is moved; called only from the worker. */
    scim: ScimApi,
    /** Where every mail identity sends goes out; notification owns the gateway. */
    notifications: NotificationService,
  };
  /** LangWatch's own sign-ups Slack webhook, shared with organization, billing and auth. */
  static readonly secrets = { internalSlackSignupsWebhook } as const;

  static async create(setup: IdentitySetup): Promise<IdentityModule> {
    const signupAnnouncements = SignupAnnouncementService.create({
      channel: setup.channels.signupAnnouncements,
      publicBaseUrl: setup.config.publicBaseUrl,
      logger: createLogger("langwatch:identity:signup-announcement"),
    });
    const engineProviders = SsoEngineProviderService.create({
      credentials: setup.repositories.ssoCredentials,
      rows: setup.repositories.ssoEngineProviders,
      baseUrl: setup.config.publicBaseUrl ?? "",
    });
    const identityEventing = ConnectedIdentityEventing.create();
    const eventStores = IdentityEventStores.create();
    // The lookup, the link proposals and the pipeline read one log through the read seat.
    const identityHistory = setup.repositories.identityHistory;
    const ledger = IdentityLedgerStore.create({
      projectionStore: setup.repositories.identityProjection,
      heads: setup.repositories.heads,
      eventing: identityEventing,
    });
    const joinRequestLedger = JoinRequestLedgerStore.create({
      projectionStore: setup.repositories.joinRequestProjection,
      eventing: identityEventing,
    });
    const reservations = setup.repositories.reservations;
    const identityGuards = IdentityGuardsService.create({
      heads: setup.repositories.heads,
      users: setup.repositories.users,
      reservations,
      identifiers: CryptoIdentifierIdentityService.create(),
    });
    const mfaGuards = MfaGuardsService.create(setup.repositories.mfaEnrollment);
    const latch = CachedIdentityLatchService.create({
      repository: setup.repositories.latch,
      ttlMs: IDENTITY_LATCH_CACHE_TTL_MS,
      maxUsers: IDENTITY_LATCH_CACHE_MAX_USERS,
      now: () => nowInstant().epochMilliseconds,
    });
    const isLatched = latch.gate();
    const emails = IdentityEmailService.create(setup.repositories.heads, isLatched);
    const identity = IdentityService.create(identityGuards, ledger);
    const verification = VerificationCeremonyService.create({
      store: setup.repositories.verification,
      heads: setup.repositories.heads,
      identity,
      deps: { isLatched },
    });
    const ceremonies = IdentityCeremoniesService.create({
      heads: setup.repositories.heads,
      users: setup.repositories.users,
      identity,
      isLatched,
      clock: { now: () => nowInstant().epochMilliseconds, newCommandId: newIdentityCommandId },
    });
    const isAnyoneOnIdentityWrites = latch.anyoneGate();
    const { accounts, resolution } = setup.repositories;
    // better-auth's `database:` (ADR-116 §1); routing and both branches once per bound engine.
    const storage = (input: IdentityStorageAdapterInput): AdapterFactory<BetterAuthOptions> =>
      BetterAuthIdentityStorageService.create({
        legacyEngine: input.legacyEngine,
        postgresTransaction: input.postgresTransaction,
        routing: ({ legacy, naming }) =>
          BetterAuthIdentityRoutingService.create({
            legacy,
            naming,
            accounts,
            isUserOnIdentityWrites: isLatched,
            passkeyRemoval: setup.repositories.passkeyRemoval,
            connectionIssuers: setup.repositories.connectionIssuers,
            accountBranch: BetterAuthAccountBranchService.create({
              legacy,
              accounts,
              resolution,
              ceremonies,
              isUserOnIdentityWrites: isLatched,
              isAnyoneOnIdentityWrites,
            }),
            userBranch: BetterAuthUserBranchService.create({
              naming,
              resolution,
              ceremonies,
              isUserOnIdentityWrites: isLatched,
            }),
          }).adapter(),
      }).factory();
    const newbornSweep = IdentityNewbornReconciliationService.create({ reservations });
    const signUpIdentifiers = SignUpIdentifierService.create({ identity });
    const secrets = IdentitySecretCarryService.create(setup.repositories.secretCarry);
    const backfill = IdentityBackfillService.create({
      reads: setup.repositories.backfill,
      users: setup.repositories.users,
      identity,
      secrets,
      plan: IdentityBackfillPlanService.create(CryptoIdentifierIdentityService.create()),
    });
    const joinRequestGuards = JoinRequestGuardsService.create({
      requests: setup.repositories.joinRequests,
    });
    const signInMethodPolicy = SignInMethodPolicyService.create({
      resolveAuthProvider: () => setup.channels.authReads.resolveAuthProvider(),
      federationLicensed: () => setup.dependencies.licensing.isPlatformSsoLicensed(),
      offersPasskeys: () => setup.config.passkeysEnabled,
      issuesOwnPasswords: () => setup.config.localPasswords,
      selfHosted: () => !setup.config.isSaas,
      mountedSocialMethodIds: () => setup.channels.authReads.findMountedSocialMethodIds(),
    });
    const passwordDoor = passwordDoorMounted(signInMethodPolicy);
    const holderCanWalkIn = breakGlassEligibility(
      setup.dependencies.organizations,
      setup.dependencies.users,
    );
    // One answer to "is there a way back in", shared: activation's second
    // precondition and the setup sign-in exemption must not disagree.
    const breakGlass = RequiresLocalDoorAndBinding.create({
      localDoor: LocalDoorBreakGlassBindingRepository.create({ passwordDoor }),
      bindings: SsoBreakGlassRecoveryService.create({
        bindings: setup.repositories.ssoBreakGlass,
        holderCanWalkIn,
      }),
    });
    const ssoConnectionReads = OrganizationSsoConnectionsService.create({
      connections: setup.repositories.ssoConnections,
    });
    // One connection service: the back office, the setup journey and the teardown timer share it.
    const ssoConnectionGraph = composeSsoConnectionGraph({
      breakGlass,
      repositories: setup.repositories,
      commands: identityEventing,
      directoryMove: SsoConnectionDirectoryMoveService.create({
        connections: ssoConnectionReads,
        scim: setup.dependencies.scim,
      }),
      engineProvider: engineProviders,
      mail: setup.channels.ssoDomainProofMail,
      licensing: setup.dependencies.licensing,
      authorization: setup.dependencies.permissions,
    });
    const ssoConnectionGuards = ssoConnectionGraph.guards;
    const ssoConnections: SsoConnectionService | null = ssoConnectionGraph.connections;
    const ssoConnectionHistory = SsoConnectionHistoryService.create({
      history: setup.repositories.ssoConnectionHistory,
    });
    const ssoAdmin = ssoConnections
      ? SsoConnectionAdminService.create({
          reads: setup.repositories.ssoAdmin,
          connections: () => ssoConnections,
          history: () => ssoConnectionHistory,
        })
      : null;
    // Auth owns the operator's IdP allowlist; asked per discovery, not at boot.
    const dialableIdpOrigins = () => setup.channels.authReads.findDialableIdentityProviderOrigins();
    // The same fence the published-proof reads go through: an issuer is a
    // string an administrator typed.
    const issuerDiscovery = setup.channels.ssoIssuerDiscovery;
    const ssoIssuers = SsoIssuerDirectoryService.create({
      connections: setup.repositories.ssoConnections,
      endpointOrigins: SsoIssuerEndpointOriginsService.create({
        discovery: issuerDiscovery,
        resolveHost: systemHostAddresses,
        dialableInternalOrigins: dialableIdpOrigins,
      }),
    });
    // The ceremony and the sweep read the SAME published evidence where it
    // lives, so they share one pair of live channels rather than each
    // deciding for itself where a customer's proof is read from.
    const domainProofChannels = ssoConnections
      ? {
          proofs: setup.channels.ssoDomainProofs,
          files: setup.channels.ssoDomainProofFiles,
        }
      : null;
    const ssoDomainCeremony =
      ssoConnections && domainProofChannels
        ? SsoDomainCeremonyService.create({
            connections: () => ssoConnections,
            reads: setup.repositories.ssoConnections,
            licensing: setup.dependencies.licensing,
            ...domainProofChannels,
          })
        : null;
    const ssoDomainReproof =
      ssoConnections && domainProofChannels
        ? SsoDomainReproofService.create({
            connections: () => ssoConnections,
            targets: setup.repositories.ssoReproofTargets,
            ...domainProofChannels,
          })
        : null;
    const ssoAssertion = SsoAssertionService.create({
      connections: setup.repositories.ssoConnections,
      registrants: SsoRegistrantReadsService.create({
        registrants: setup.repositories.ssoRegistrants,
        organizations: setup.dependencies.organizations,
      }),
      breakGlass,
      resolution: SsoUserResolutionService.create({
        people: setup.repositories.ssoRegistrants,
        connections: setup.repositories.ssoConnections,
        directory: setup.dependencies.scim,
        memberships: setup.dependencies.organizations,
        isHosted: setup.config.isSaas,
        proposals: identity,
        auditLog: setup.dependencies.auditLog,
      }),
    });
    const joinRequests = JoinRequestsService.create({
      requests: JoinRequestService.create(joinRequestGuards, joinRequestLedger),
      reads: setup.repositories.joinRequests,
      candidates: setup.repositories.joinCandidates,
      membership: joinMemberships(setup.dependencies.organizations),
      settings: joinSettings(setup.dependencies.organizations),
      dismissals: joinOfferDismissals(setup.dependencies.users),
      audit: joinSettingAudit(setup.dependencies.auditLog),
      autoJoinLicensed: () => setup.dependencies.licensing.isPlatformSsoLicensed(),
      joinPolicyEntitled: async ({ organizationId }) =>
        isEnterpriseTier(
          (await setup.dependencies.entitlements.getActivePlan({ organizationId })).type,
        ),
      rateLimit: joinRateLimit(setup.repositories.rateLimits),
    });
    // `notifications` is unanswered on purpose: an automatic admission's
    // durable notice needs a mail this process does not compose.
    const ssoArrival = SsoArrivalService.create({
      joinRequests,
      connections: setup.repositories.ssoConnections,
      memberships: arrivalMemberships(setup.dependencies.organizations),
      authz: setup.dependencies.permissions,
      adoption: SsoArrivalAdoptionService.create({
        backfill,
        latch: setup.repositories.latch,
      }),
      signups: signupAnnouncements,
    });
    const ssoTestArrival = SsoTestArrivalService.create({
      accounts: testArrivalAccounts(setup.channels.authReads),
      connections: setup.repositories.ssoConnections,
      memberships: testArrivalMemberships(setup.dependencies.organizations),
    });
    const ssoActivity = SsoAuthenticationActivityService.create({
      connections: setup.repositories.ssoConnections,
      activity: setup.repositories.ssoMigrationEvidence,
    });
    const ssoMigrationCallbacks = SsoMigrationCallbackService.create({
      connections: setup.repositories.ssoConnections,
      users: setup.repositories.users,
      memberships: setup.dependencies.organizations,
      trail: ssoActivity,
    });
    const memberships = migrationMemberships(setup.dependencies.organizations);
    const legacyAccess = legacySsoAccess({
      reads: setup.channels.authReads,
      auth: setup.channels.authCommands,
    });
    // `directory` is unanswered here: whether provisioning has been repointed
    // is the directory module's to say, and an installation without one
    // provisions nobody — which is what `not-applicable` means.
    const ssoMigrationProgress = SsoMigrationProgressService.create({
      connections: setup.repositories.ssoConnections,
      evidence: setup.repositories.ssoMigrationEvidence,
      breakGlass: setup.repositories.ssoBreakGlass,
      holderCanWalkIn,
      memberships,
      legacyAccess,
    });
    // Q3(c) again: without the connection ledger there is nothing to press
    // against, so the journey's verbs refuse by name rather than half-work.
    const ssoSetupCommands = ssoConnections
      ? SsoSetupCommandsService.create({
          connections: () => ssoConnections,
          reads: setup.repositories.ssoConnections,
          activity: setup.repositories.ssoMigrationEvidence,
          idpCredentials: SsoIdpCredentialsService.create({
            credentials: setup.repositories.ssoCredentials,
            registrations: SsoIdpRegistrationService.create({ discovery: issuerDiscovery }),
          }),
          breakGlass,
          passwordDoor,
          finalization: SsoMigrationFinalizationService.create({
            connections: () => ssoConnections,
            evidence: ssoMigrationProgress,
            retirement: SsoLegacyIdentityRetirementService.create({
              identity,
              connections: setup.repositories.ssoConnections,
              evidence: setup.repositories.ssoMigrationEvidence,
              memberships,
              legacyAccess,
            }),
          }),
        })
      : null;
    const ssoBreakGlassGrants = SsoBreakGlassService.create({
      bindings: setup.repositories.ssoBreakGlass,
      warnings: setup.channels.ssoBreakGlassWarnings,
      newBindingId: newSsoBreakGlassBindingId,
      directory: breakGlassDirectory(setup.dependencies.organizations),
      holderIsEligible: holderCanWalkIn,
    });
    const ssoSetup = SsoSetupService.create({
      connections: setup.repositories.ssoConnections,
      breakGlass: setup.repositories.ssoBreakGlass,
      activity: setup.repositories.ssoMigrationEvidence,
      migrations: ssoMigrationProgress,
      entitled: async ({ organizationId }) =>
        isEnterpriseTier(
          (await setup.dependencies.entitlements.getActivePlan({ organizationId })).type,
        ),
    });
    const resolveAuthProvider = () => setup.channels.authReads.resolveAuthProvider();
    const mountedMethods = () =>
      SignInMethodPolicyService.findFederatedMethods(resolveAuthProvider);
    // Main's router (identity/runtime.ts): projected connections first, the legacy columns
    // when none decides, the method policy, one break-glass budget, the account lookup.
    const legacyDomainRouting = LegacySsoDomainRoutingService.create({
      organizations: setup.repositories.legacySsoOrganizations,
      mountedMethods,
    });
    const connectionDomainRouting = SsoConnectionRoutingService.create({
      connections: setup.repositories.ssoConnectionRouting,
      dial: ssoMethodDialWith({
        mountedMethods: async () => (await mountedMethods()).map((method) => method.id),
        engineHoldsProvider: (args) =>
          setup.repositories.ssoEngineProviders.findRegisteredProvider(args),
      }),
    });
    // D04: its proof reads through the two routing ports that decide sign-in, never the store.
    const ssoConnectionGrandfather = ssoConnections
      ? SsoConnectionGrandfatherService.create({
          connections: ssoConnections,
          legacy: setup.repositories.legacySsoOrganizations,
          legacyRouting: legacyDomainRouting,
          connectionRouting: connectionDomainRouting,
          // The legacy columns name a provider and nothing else: a reference to the mounted one.
          idpMetadataFor: ({ ssoProvider }) => ({
            issuer: null,
            providerId: ssoProvider,
            clientIdRef: null,
            secretRef: null,
            certRefs: [],
          }),
        })
      : null;
    const signInRouter = SignInRouterService.create({
      legacy: legacyDomainRouting,
      domains: connectionDomainRouting,
      policy: signInMethodPolicy,
      breakGlass: InProcessBreakGlassLimiterService.create(),
      accounts: SignInAccountLookupService.create({
        heads: setup.repositories.heads,
        legacy: setup.repositories.signInAccounts,
        isLatched,
      }),
    });

    const joinAdmissions = JoinAdmissionsService.create(setup.repositories.joinRequests);

    // auth's databaseHooks: a latched user's account ceremony is the adapter's alone (ADR-116 §5).
    const bridge = BetterAuthCeremonyBridgeService.create({
      ceremonies,
      routesToIdentity: isLatched,
    });
    const hookCeremonies: IdentityCeremoniesApi = {
      beforeUserDelete: (user) => ceremonies.beforeUserDelete(user),
      createAccountIdentifier: (account) => bridge.createAccountIdentifier(account),
      beforeAccountDelete: (account) => bridge.beforeAccountDelete(account),
    };

    return new IdentityModule({
      emails,
      ceremonies: hookCeremonies,
      storage,
      identityGuards,
      mfaGuards,
      reservations,
      identity,
      verification,
      sessionClaims: SessionClaimsService.create({
        heads: setup.repositories.heads,
        identifiers: CryptoIdentifierIdentityService.create(),
      }),
      accountIdentifiers: AccountIdentifiersService.create({
        heads: setup.repositories.heads,
        identity,
        ceremony: verification,
        mail: setup.channels.addressConfirmationMail,
        rateLimiter: setup.repositories.rateLimits,
        sessions: setup.channels.authReads,
        accountAddress: async ({ userId }) => {
          const user = await setup.dependencies.users.findById({ id: userId });
          return user?.email ? { email: user.email, confirmed: user.emailVerified } : null;
        },
        hasMailDelivery: async () =>
          (await setup.dependencies.notifications.getMailDelivery()).provider !== undefined,
      }),
      microsoftAccountRekey: MicrosoftAccountRekeyService.create({
        accounts: setup.repositories.accountRekey,
      }),
      newbornSweep,
      signUpIdentifiers,
      backfill,
      secrets,
      ssoDomainOwnershipBackfill: SsoDomainOwnershipBackfillService.create(
        setup.repositories.ssoDomainOwnership,
      ),
      ssoConnectionGrandfather,
      joinRequestGuards,
      ssoConnections,
      ssoConnectionGuards,
      ssoAdmin,
      ssoConnectionHistory,
      ssoConnectionReads,
      ssoIssuers,
      ssoDomainCeremony,
      ssoDomainReproof,
      ssoAssertion,
      ssoArrival,
      ssoTestArrival,
      joinAdmissions,
      joinRequests,
      joinRequestDoor: JoinRequestDoorService.create({
        joinRequests,
        admissions: joinAdmissions,
        emails,
        users: setup.dependencies.users,
      }),
      ssoActivity,
      ssoMigrationCallbacks,
      ssoBreakGlass: ssoBreakGlassGrants,
      ssoSetup,
      ssoSetupCommands,
      lookup: IdentityLookupService.create({
        reads: setup.repositories.identityLookup,
        history: identityHistory,
        router: signInRouter,
        identity: () => identity,
        links: LinkProposalService.create({
          guards: LinkProposalGuardsService.create({
            proposals: identityHistory,
          }),
          ledger,
          proposals: identityHistory,
          accounts: setup.channels.authCommands,
        }),
        auditLog: setup.dependencies.auditLog,
        rateLimiter: setup.repositories.rateLimits,
        sessions: {
          listBrowserSessions: (args) => setup.channels.authReads.listBrowserSessions(args),
          revokeAllBrowserSessions: (args) =>
            setup.channels.authCommands.revokeAllBrowserSessions(args),
          endBrowserSessionsForIdentifier: (args) =>
            setup.channels.authCommands.endBrowserSessionsForIdentifier(args),
        },
        invitations: setup.dependencies.organizations,
      }),
      twoStepAccounts: TwoStepAccountService.create({
        accounts: setup.repositories.twoStepVerification,
        deployment: { offersTwoStepVerification: () => setup.config.mfaEnrollmentOpen },
        protocol: setup.channels.authCommands,
      }),
      organizationMfa: OrganizationMfaService.create({
        accounts: setup.repositories.twoStepVerification,
        auth: {
          findSessionAmr: (args) => setup.channels.authReads.findSessionAmr(args),
          findAssertedAmrForIdentifiers: (args) =>
            setup.channels.authReads.findAssertedAmrForIdentifiers(args),
          offersTwoStepVerification: () => setup.config.mfaEnrollmentOpen,
        },
        notifier: OrganizationMfaNotifierService.create({
          accounts: setup.repositories.twoStepVerification,
          mail: setup.channels.organizationMfaMail,
          emails,
        }),
        entitled: async ({ organizationId }) =>
          isEnterpriseTier(
            (await setup.dependencies.entitlements.getActivePlan({ organizationId })).type,
          ),
      }),
      signInRouter,
      pipelines: {
        eventing: identityEventing,
        stores: eventStores,
        identity: () =>
          composeIdentityPipeline({ repositories: setup.repositories, history: identityHistory }),
        joinRequests: () =>
          composeJoinRequestPipeline({
            repositories: setup.repositories,
            eventStore: eventStores.of({ pipeline: JOIN_REQUEST_PIPELINE_NAME }),
            commands: identityEventing,
            notifier: JoinRequestNotifierService.create({
              audience: setup.repositories.joinRequestAudience,
              context: setup.repositories.joinRequestNotificationContext,
              mail: setup.channels.joinRequestMail,
              baseHost: setup.config.publicBaseUrl ?? "",
              plans: setup.dependencies.entitlements,
            }),
          }),
        ssoConnections: ssoConnectionGraph.pipeline,
      },
    });
  }

  identityPipeline(): IdentityPipeline {
    return this.#parts.pipelines.identity();
  }

  joinRequestPipeline(): JoinRequestPipeline {
    return this.#parts.pipelines.joinRequests();
  }

  ssoConnectionPipeline(): SsoConnectionPipeline {
    return this.#parts.pipelines.ssoConnections();
  }

  /** Keeps a built pipeline's own event store; a build only to be listed keeps nothing. */
  keepEventStore(input: {
    pipeline: string;
    participation: EventingParticipation;
    eventStore: OwnEventStore | undefined;
  }): void {
    this.#parts.pipelines.stores.keep(input);
  }

  /** Hands identity a registered pipeline's senders; a missing verb fails the install. */
  connectPipeline(input: { pipeline: string; commands: object }): void {
    this.#parts.pipelines.eventing.connect(input);
  }

  readonly #parts: IdentityAppParts;

  private constructor(parts: IdentityAppParts) {
    this.#parts = parts;
  }

  resolveEmail(input: { userId: string }): Promise<IdentityEmailResolution> {
    return this.#parts.emails.resolveEmail(input);
  }

  verifiedEmailsOf(input: { userId: string }): Promise<VerifiedEmailsResolution> {
    return this.#parts.emails.verifiedEmailsOf(input);
  }

  completeEmailVerification(input: {
    userId: string;
    identifierId: string;
    verificationId: string;
    token: string;
    codeVerifier: string;
  }): Promise<void> {
    return this.#parts.verification.completeEmailVerification(input);
  }

  listAccountIdentifiers(input: { userId: string }): Promise<AccountIdentifier[]> {
    return this.#parts.accountIdentifiers.listIdentifiers(input);
  }

  addEmailIdentifier(input: {
    userId: string;
    email: string;
    codeChallenge: string;
  }): Promise<EmailIdentifierAdded> {
    return this.#parts.accountIdentifiers.addEmailIdentifier(input);
  }

  resendIdentifierConfirmation(input: {
    userId: string;
    identifierId: string;
    codeChallenge: string;
  }): Promise<void> {
    return this.#parts.accountIdentifiers.resendConfirmation(input);
  }

  sendOwnAddressConfirmation(input: {
    userId: string;
    email: string;
    codeChallenge: string;
  }): Promise<EmailIdentifierAdded> {
    return this.#parts.accountIdentifiers.sendOwnAddressConfirmation(input);
  }

  removeIdentifier(input: { userId: string; identifierId: string }): Promise<void> {
    return this.#parts.accountIdentifiers.removeIdentifier(input);
  }

  moveLegacyMicrosoftAccountKey(input: {
    profile: Readonly<Record<string, unknown>>;
  }): Promise<void> {
    return this.#parts.microsoftAccountRekey.moveOnSignIn(input);
  }

  routeSignIn(
    input: Readonly<{ identifier: string | null; breakGlass: boolean }>,
  ): Promise<RoutingDecision> {
    return this.#parts.signInRouter.route(input);
  }

  claimsForMint(input: SessionClaimsMintInput): Promise<SessionClaims> {
    return this.#parts.sessionClaims.claimsForMint(input);
  }

  getMethodsLastUsed(input: { userId: string }): Promise<MethodsLastUsed> {
    return this.#parts.accountIdentifiers.getMethodsLastUsed(input);
  }

  getTwoStepAccountStanding(input: { userId: string }): Promise<TwoStepAccountStanding> {
    return this.#parts.twoStepAccounts.getStanding(input);
  }

  findOrganizationMemberFactors(input: {
    organizationId: string;
  }): Promise<OrganizationMemberFactor[]> {
    return this.#parts.organizationMfa.findMemberFactors(input);
  }

  getOrganizationMfaStanding(input: {
    userId: string;
    organizationId: string;
    sessionId: string | null;
  }): Promise<OrganizationMfaStanding> {
    return this.#parts.organizationMfa.getStanding(input);
  }

  getOrganizationMfaRequirement(input: {
    organizationId: string;
  }): Promise<OrganizationMfaRequirement> {
    return this.#parts.organizationMfa.getRequirement(input);
  }

  setOrganizationMfaRequirement(input: {
    organizationId: string;
    mfaRequired: boolean;
    actorUserId: string;
  }): Promise<OrganizationMfaRequirementChange> {
    return this.#parts.organizationMfa.setRequirement(input);
  }

  disableTwoStepVerification(input: {
    userId: string;
    password?: string | undefined;
    code: string;
    headers: RequestHeaderRecord;
  }): Promise<TwoStepDisabled> {
    return this.#parts.twoStepAccounts.disable(input);
  }

  guards(): IdentityGuardsService {
    return this.#parts.identityGuards;
  }

  mfaGuards(): MfaGuardsService {
    return this.#parts.mfaGuards;
  }

  reservations(): IdentityReservationsApi {
    const reservations = this.#parts.reservations;
    return {
      claim: (args: {
        normalizedValue: string;
        userId: string;
        identifierId: string;
        commandId: string;
      }) => reservations.claim(args),
      release: (args: { userId: string; holdingIdentifierIds: readonly string[] }) =>
        reservations.release(args),
      // The boundary member takes no args on purpose — the same reap-horizon and
      // per-pass cap `IdentityNewbornReconciliationService` already uses for this
      // exact repository call (`reapAddressLocks`), not a caller-chosen one.
      reapOrphans: () =>
        reservations.reapOrphans({
          olderThan: Temporal.Instant.fromEpochMilliseconds(
            nowInstant().epochMilliseconds - IDENTITY_NEWBORN_ABANDONED_AFTER_MS,
          ),
          limit: RESERVATIONS_REAP_LIMIT_PER_PASS,
        }),
    };
  }

  identity(): IdentityService {
    return this.#parts.identity;
  }

  ceremonies(): IdentityCeremoniesApi {
    return this.#parts.ceremonies;
  }

  createStorageAdapter(input: IdentityStorageAdapterInput): AdapterFactory<BetterAuthOptions> {
    return this.#parts.storage(input);
  }

  newbornSweep(): IdentityNewbornReconciliationService {
    return this.#parts.newbornSweep;
  }

  signUpIdentifiers(): SignUpIdentifierService {
    return this.#parts.signUpIdentifiers;
  }

  userMigrations(): readonly SystemMigration[] {
    return [
      IdentityIdentifierBackfillMigrationService.create(this.#parts.backfill),
      IdentitySecretHealMigrationService.create(this.#parts.secrets),
    ] as const;
  }

  registeredMigrations(): readonly SystemMigration[] {
    const { ssoConnectionGrandfather, ssoDomainOwnershipBackfill } = this.#parts;

    return [
      ...(ssoConnectionGrandfather
        ? [IdentityConnectionGrandfatherMigrationService.create(ssoConnectionGrandfather)]
        : []),
      SsoDomainOwnershipMigrationService.create(ssoDomainOwnershipBackfill),
    ];
  }

  joinRequestGuards(): JoinRequestGuardsService {
    return this.#parts.joinRequestGuards;
  }

  ssoConnections(): SsoConnectionService {
    if (!this.#parts.ssoConnections) {
      throw new IdentityCapabilityUnavailableError("SSO connection store");
    }
    return this.#parts.ssoConnections;
  }

  ssoConnectionGuards(): SsoConnectionGuardsService {
    return this.#parts.ssoConnectionGuards;
  }

  ssoAdmin(): SsoConnectionAdminService {
    if (!this.#parts.ssoAdmin || !this.#holdsSsoConnectionLog()) {
      throw new IdentityCapabilityUnavailableError("SSO connection admin");
    }
    return this.#parts.ssoAdmin;
  }

  ssoConnectionHistory(): SsoConnectionHistoryService {
    if (!this.#holdsSsoConnectionLog()) {
      throw new IdentityCapabilityUnavailableError("SSO connection history");
    }
    return this.#parts.ssoConnectionHistory;
  }

  /** Whether this process built sso_connection over a store: without it there is no log to read. */
  #holdsSsoConnectionLog(): boolean {
    return this.#parts.pipelines.stores.holds({ pipeline: SSO_CONNECTION_PIPELINE_NAME });
  }

  ssoConnectionReads(): OrganizationSsoConnectionsService {
    return this.#parts.ssoConnectionReads;
  }

  ssoIssuers(): SsoIssuerDirectoryService {
    return this.#parts.ssoIssuers;
  }

  ssoDomainCeremony(): SsoDomainCeremonyService {
    if (!this.#parts.ssoDomainCeremony) {
      throw new IdentityCapabilityUnavailableError("SSO domain ceremony");
    }

    return this.#parts.ssoDomainCeremony;
  }

  ssoDomainReproof(): SsoDomainReproofService {
    if (!this.#parts.ssoDomainReproof) {
      throw new IdentityCapabilityUnavailableError("SSO domain re-proof sweep");
    }

    return this.#parts.ssoDomainReproof;
  }

  ssoAssertion(): SsoAssertionService {
    return this.#parts.ssoAssertion;
  }

  ssoArrival(): SsoArrivalService {
    return this.#parts.ssoArrival;
  }

  ssoTestArrival(): SsoTestArrivalService {
    return this.#parts.ssoTestArrival;
  }

  joinAdmissions(): JoinAdmissionsService {
    return this.#parts.joinAdmissions;
  }

  joinRequests(): JoinRequestsService {
    return this.#parts.joinRequests;
  }

  joinRequestDoor(): JoinRequestDoorService {
    return this.#parts.joinRequestDoor;
  }

  ssoActivity(): SsoAuthenticationActivityService {
    return this.#parts.ssoActivity;
  }

  ssoMigrationCallbacks(): SsoMigrationCallbackService {
    return this.#parts.ssoMigrationCallbacks;
  }

  ssoSetup(): SsoSetupService {
    return this.#parts.ssoSetup;
  }

  ssoBreakGlass(): SsoBreakGlassService {
    return this.#parts.ssoBreakGlass;
  }

  ssoSetupCommands(): SsoSetupCommandsService {
    if (!this.#parts.ssoSetupCommands) {
      throw new IdentityCapabilityUnavailableError("SSO setup commands");
    }

    return this.#parts.ssoSetupCommands;
  }

  lookupAddress(input: {
    address: string;
    operator: IdentityLookupOperator;
  }): Promise<IdentityLookupAnswer> {
    return this.#parts.lookup.lookupAddress(input);
  }

  getLookupPerson(input: {
    userId: string;
    address: string;
    operator: IdentityLookupOperator;
  }): Promise<LookupPersonDetail> {
    return this.#parts.lookup.getLookupPerson(input);
  }

  findLookupActivity(input: {
    operator: IdentityLookupOperator;
  }): Promise<LookupOperatorActivityRow[]> {
    return this.#parts.lookup.findLookupActivity(input);
  }

  findVerifiedDomainsByUserIds(input: {
    userIds: readonly string[];
  }): Promise<VerifiedUserDomain[]> {
    return this.#parts.lookup.findVerifiedDomainsByUserIds(input);
  }

  findDomainClaimQueue(input: { operator: IdentityLookupOperator }): Promise<LookupDomainClaim[]> {
    return this.#parts.lookup.findDomainClaimQueue(input);
  }

  confirmProposedSignIn(input: {
    userId: string;
    proposalId: string;
    operator: IdentityLookupOperator;
  }): Promise<void> {
    return this.#parts.lookup.confirmProposedSignIn(input);
  }

  rejectProposedSignIn(input: {
    userId: string;
    proposalId: string;
    operator: IdentityLookupOperator;
  }): Promise<void> {
    return this.#parts.lookup.rejectProposedSignIn(input);
  }

  detachLookupMethod(input: {
    userId: string;
    identifierId: string;
    operator: IdentityLookupOperator;
  }): Promise<void> {
    return this.#parts.lookup.detachLookupMethod(input);
  }

  endLookupSessions(input: {
    userId: string;
    identifierId: string | null;
    operator: IdentityLookupOperator;
  }): Promise<void> {
    return this.#parts.lookup.endLookupSessions(input);
  }

  resendLookupInvitation(input: {
    organizationId: string;
    inviteId: string;
    operator: IdentityLookupOperator;
  }): Promise<LookupInvitationExpiry> {
    return this.#parts.lookup.resendLookupInvitation(input);
  }

  extendLookupInvitation(input: {
    organizationId: string;
    inviteId: string;
    operator: IdentityLookupOperator;
  }): Promise<LookupInvitationExpiry> {
    return this.#parts.lookup.extendLookupInvitation(input);
  }

  recordRefusedLookup(input: {
    operator: IdentityLookupOperator;
    action: string;
    args: Readonly<Record<string, string | null>>;
  }): Promise<void> {
    return this.#parts.lookup.recordRefusedLookup(input);
  }
}
