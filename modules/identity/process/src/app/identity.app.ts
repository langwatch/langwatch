/**
 * The identity feature's application: guards, ledger writer, backfill,
 * newborn sweep, join-request/SSO-connection/directory-sync guards — every
 * capability crossing a package boundary today (ADR-101, 115, 116, 117).
 */
import { SYSTEM_ACTORS } from "@langwatch/actor";
import { AuditLogApi } from "@langwatch/audit-log-contract";
import { AuthApi } from "@langwatch/auth-contract";
import { AuthzApi } from "@langwatch/authz-contract";
import { LicensingApi } from "@langwatch/enterprise-licensing-contract";
import { ScimApi } from "@langwatch/enterprise-scim-contract";
import { EntitlementApi, isEnterpriseTier } from "@langwatch/entitlement-contract";
import {
  type AccountIdentifier,
  type EmailIdentifierAdded,
  IdentityApi,
  IdentityCapabilityUnavailableError,
  identityConfig,
  sealedProviderConfigCipher,
  type IdentityEmailResolution,
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
} from "@langwatch/identity-contract";
import type { EventingParticipation, FeatureSetup } from "@langwatch/kernel";
import type { EmailDelivery } from "@langwatch/mail";
import { OrganizationApi } from "@langwatch/organization-contract";
import { reads, type MembersRead, type RateLimiter } from "@langwatch/process-stores/members";
import type { SystemMigration } from "@langwatch/system-migrations";
import { Temporal, nowInstant } from "@langwatch/time";
import { UserApi } from "@langwatch/user-contract";

import { addressConfirmationMailChannels } from "../channels/address-confirmation-mail-channels.registry.ts";
import { joinRequestNotificationMailChannels } from "../channels/join-request-notification-mail-channels.registry.ts";
import { organizationMfaRequirementMailChannels } from "../channels/organization-mfa-requirement-mail-channels.registry.ts";
import { LoggedSsoBreakGlassWarningChannel } from "../channels/sso-break-glass-warning.channel.ts";
import {
  ssoDomainProofChannels,
  ssoDomainProofFileChannels,
} from "../channels/sso-domain-proof-channels.registry.ts";
import { SSO_DOMAIN_PROOF_PUBLIC_EGRESS } from "../channels/sso-domain-proof-file.channel.ts";
import { ssoIssuerDiscoveryChannels } from "../channels/sso-issuer-discovery-channels.registry.ts";
import {
  composeJoinRequestPipeline,
  type JoinRequestPipeline,
} from "../eventing/join-request.pipeline.ts";
import { composeScimSyncPipeline, type ScimSyncPipeline } from "../eventing/scim-sync.pipeline.ts";
import {
  composeSsoConnectionGraph,
  type SsoConnectionPipeline,
} from "../eventing/sso-connection.pipeline.ts";
import {
  composeIdentityPipeline,
  type IdentityPipeline,
} from "../eventing/user-identity.pipeline.ts";
import type { IdentityRepositories } from "../repositories/identity.repositories.ts";
import { LocalDoorBreakGlassBindingRepository } from "../repositories/local/local.door-break-glass-binding.repository.ts";
import { breakGlassHolderEligibility } from "../rules/break-glass-eligibility.rules.ts";
import type {
  JoinMembership,
  JoinOfferDismissals,
  JoinRequestsServiceDeps,
  JoinSetting,
  JoinSettingAudit,
} from "../rules/join-requests-contract.rules.ts";
import type { SsoArrivalMemberships } from "../rules/sso-arrival-contract.rules.ts";
import { newSsoBreakGlassBindingId } from "../rules/sso-connection-id.rules.ts";
import { ssoMethodDialWith } from "../rules/sso-method-dial.rules.ts";
import { AccountIdentifiersService } from "../services/account-identifiers.service.ts";
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
import { InProcessBreakGlassLimiterService } from "../services/in-process-break-glass-limiter.service.ts";
import { JoinAdmissionsService } from "../services/join-admissions.service.ts";
import { JoinRequestGuardsService } from "../services/join-request-guards.service.ts";
import { JoinRequestNotifierService } from "../services/join-request-notifier.service.ts";
import { JoinRequestService } from "../services/join-request.service.ts";
import { JoinRequestsService } from "../services/join-requests.service.ts";
import { LinkProposalGuardsService } from "../services/link-proposal-guards.service.ts";
import { LinkProposalService } from "../services/link-proposal.service.ts";
import { MfaGuardsService } from "../services/mfa-guards.service.ts";
import { OrganizationMfaNotifierService } from "../services/organization-mfa-notifier.service.ts";
import { OrganizationMfaService } from "../services/organization-mfa.service.ts";
import { OrganizationSsoConnectionsService } from "../services/organization-sso-connections.service.ts";
import { CachedIdentityLatchService } from "../services/per-subject-cached-latch.service.ts";
import { ScimSyncGuardsService } from "../services/scim-sync-guards.service.ts";
import { ScimSyncReadsService } from "../services/scim-sync-reads.service.ts";
import { SignInAccountLookupService } from "../services/signin-account-lookup.service.ts";
import { SignInRouterService } from "../services/signin-router.service.ts";
import { SsoArrivalAdoptionService } from "../services/sso-arrival-adoption.service.ts";
import { SsoArrivalService } from "../services/sso-arrival.service.ts";
import { SsoAssertionService } from "../services/sso-assertion.service.ts";
import { SsoAuthenticationActivityService } from "../services/sso-authentication-activity.service.ts";
import { SsoBreakGlassRecoveryService } from "../services/sso-break-glass-recovery.service.ts";
import {
  RequiresLocalDoorAndBinding,
  SsoBreakGlassService,
  type SsoBreakGlassDirectory,
} from "../services/sso-break-glass.service.ts";
import { SsoConnectionBackofficeService } from "../services/sso-connection-backoffice.service.ts";
import { SsoConnectionDirectoryMoveService } from "../services/sso-connection-directory-move.service.ts";
import type { SsoConnectionGuardsService } from "../services/sso-connection-guards.service.ts";
import { SsoConnectionHistoryService } from "../services/sso-connection-history.service.ts";
import { SsoConnectionRoutingService } from "../services/sso-connection-routing.service.ts";
import type { SsoConnectionService } from "../services/sso-connection.service.ts";
import { SsoDomainCeremonyService } from "../services/sso-domain-ceremony.service.ts";
import { SsoDomainReproofService } from "../services/sso-domain-reproof.service.ts";
import { SsoEngineProviderService } from "../services/sso-engine-provider.service.ts";
import { SsoIdpRegistrationService } from "../services/sso-idp-registration.service.ts";
import { SsoIssuerDirectoryService } from "../services/sso-issuer-directory.service.ts";
import {
  SsoLegacyIdentityRetirementService,
  type SsoLegacyAccessRetirement,
  type SsoRetirementMemberships,
} from "../services/sso-legacy-identity-retirement.service.ts";
import { SsoMigrationCallbackService } from "../services/sso-migration-callback.service.ts";
import { SsoMigrationFinalizationService } from "../services/sso-migration-finalization.service.ts";
import { SsoMigrationProgressService } from "../services/sso-migration-progress.service.ts";
import { SsoRegistrantReadsService } from "../services/sso-registrant-reads.service.ts";
import { SsoSetupCommandsService } from "../services/sso-setup-commands.service.ts";
import { SsoSetupService } from "../services/sso-setup.service.ts";
import {
  SsoTestArrivalService,
  type SsoTestArrivalAccounts,
  type SsoTestArrivalMemberships,
} from "../services/sso-test-arrival.service.ts";
import { IdentityIdentifierBackfillMigrationService } from "../services/system-migration-identity-identifier-backfill.service.ts";
import { IdentitySecretHealMigrationService } from "../services/system-migration-identity-secret-heal.service.ts";
import { TwoStepAccountService } from "../services/two-step-account.service.ts";
import { VerificationCeremonyService } from "../services/verification-ceremony.service.ts";
import {
  buildIdentityInfrastructure,
  ConnectedIdentityEventing,
} from "./identity-composition.build.ts";
import { IdentityProducerPipelines } from "./identity-producer-composition.build.ts";
/**
 * The boundary `reservations().reapOrphans()` call takes no args, so it bounds
 * itself per pass the same way `IdentityNewbornReconciliationService`'s own
 * internal reap of this exact repository call does.
 */
const RESERVATIONS_REAP_LIMIT_PER_PASS = 200;
type IdentityMembers = MembersRead<readonly ["prisma", "eventing", "encryption", "rateLimiter"]> &
  Readonly<{
    /** LangWatch's own cloud: what licenses federation, and so automatic joining. */
    isSaas: boolean;
    /** The process mail member; with mail off each send is skipped with one line. */
    mail: EmailDelivery;
    adminEmails: readonly string[];
    /** Where this deployment answers, which is what a SAML identity provider
     *  is told LangWatch is called. A process fact, not one of the fourteen. */
    publicBaseUrl: string | undefined;
  }>;

type IdentitySetup = FeatureSetup<
  typeof IdentityApp.dependencies,
  IdentityMembers,
  IdentityServerConfig
> &
  Readonly<{ repositories: IdentityRepositories }>;

type IdentityAppParts = {
  emails: IdentityEmailService;
  identityGuards: IdentityGuardsService;
  mfaGuards: MfaGuardsService;
  reservations: IdentityRepositories["reservations"];
  identity: IdentityService;
  verification: VerificationCeremonyService;
  accountIdentifiers: AccountIdentifiersService;
  newbornSweep: IdentityNewbornReconciliationService;
  backfill: IdentityBackfillService;
  secrets: IdentitySecretCarryService;
  joinRequestGuards: JoinRequestGuardsService;
  ssoConnections: SsoConnectionService | null;
  ssoConnectionGuards: SsoConnectionGuardsService;
  ssoBackoffice: SsoConnectionBackofficeService | null;
  ssoConnectionHistory: SsoConnectionHistoryService | null;
  ssoConnectionReads: OrganizationSsoConnectionsService;
  ssoIssuers: SsoIssuerDirectoryService;
  ssoDomainCeremony: SsoDomainCeremonyService | null;
  ssoDomainReproof: SsoDomainReproofService | null;
  ssoAssertion: SsoAssertionService;
  ssoArrival: SsoArrivalService;
  ssoTestArrival: SsoTestArrivalService;
  joinAdmissions: JoinAdmissionsService;
  joinRequests: JoinRequestsService;
  ssoActivity: SsoAuthenticationActivityService;
  ssoMigrationCallbacks: SsoMigrationCallbackService;
  ssoBreakGlass: SsoBreakGlassService;
  ssoSetup: SsoSetupService;
  ssoSetupCommands: SsoSetupCommandsService | null;
  scimSyncGuards: ScimSyncGuardsService;
  scimSyncReads: ScimSyncReadsService;
  lookup: IdentityLookupService;
  twoStepAccounts: TwoStepAccountService;
  organizationMfa: OrganizationMfaService;
  signInRouter: SignInRouterService;
  pipelines: IdentityPipelineBuilders;
};

/** The four pipelines' definitions: producer stand-ins, or the full graph built only on consume. */
type IdentityPipelineBuilders = {
  eventing: ConnectedIdentityEventing;
  producer: IdentityProducerPipelines;
  identity: () => IdentityPipeline;
  joinRequests: () => JoinRequestPipeline;
  scimSync: () => ScimSyncPipeline;
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
function testArrivalAccounts(auth: AuthApi): SsoTestArrivalAccounts {
  return { findAccountProvidersForUser: (args) => auth.findFederatedAccountProviders(args) };
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
function legacySsoAccess(auth: AuthApi): SsoLegacyAccessRetirement {
  return {
    count: (args) => auth.countLegacySsoAccess(args),
    retire: (args) => auth.retireLegacySsoAccess(args),
  };
}

/** Membership is the organization's (ADR-129): a join lands through the arrival's door. */
function joinMemberships(organizations: OrganizationApi): JoinMembership {
  return {
    isMember: (args) => organizations.isMember(args),
    // The approving admin, or the policy that approved: the grant is audited to them.
    attachDefaultMembership: async ({ userId, organizationId, commandId, approvedByUserId }) => {
      await organizations.createMembership({
        userId,
        organizationId,
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
    write: ({ organizationId, domainJoin, joinDomains }) =>
      organizations.saveJoinSetting({ organizationId, setting: { domainJoin, joinDomains } }),
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
        },
        targetKind: "organization",
        targetId: organizationId,
      });
    },
  };
}

/** The process's one counter, in the window and allowance the join throttles name. */
function joinRateLimit(limiter: RateLimiter): JoinRequestsServiceDeps["rateLimit"] {
  return async ({ key, windowSeconds, max }) => {
    const decision = await limiter.check(key, { requests: max, seconds: windowSeconds });
    const retryAfterMs = (decision.retryAfterSeconds ?? windowSeconds) * 1000;

    return { allowed: decision.allowed, resetAt: nowInstant().epochMilliseconds + retryAfterMs };
  };
}

export class IdentityApp implements IdentityApi, IdentityLookupApi, TwoStepVerificationApi {
  static readonly contract = IdentityApi;
  static readonly config = identityConfig;
  /** The two peers an admission orchestrates: the module that owns
   *  membership rows, and the one that owns the pending-admission marker. */
  static readonly dependencies = {
    organizations: OrganizationApi,
    permissions: AuthzApi,
    /** Who holds the federated account rows a cutover retires: identity
     *  decides, auth owns and sweeps them. */
    auth: AuthApi,
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
  };
  static readonly reads = [
    ...reads("prisma", "eventing", "encryption", "rateLimiter"),
    "isSaas",
    "mail",
    "adminEmails",
    "publicBaseUrl",
  ] as const;

  static create(setup: IdentitySetup): IdentityApp {
    const engineProviders = SsoEngineProviderService.create({
      credentials: setup.repositories.ssoCredentials,
      rows: setup.repositories.ssoEngineProviders,
      baseUrl: setup.members.publicBaseUrl ?? "",
      providerConfig: sealedProviderConfigCipher(setup.members.encryption),
    });
    const identityEventing = ConnectedIdentityEventing.create();
    const infrastructure = buildIdentityInfrastructure({
      repositories: setup.repositories,
      eventing: setup.members.eventing,
      identityEventing,
      adminEmails: setup.members.adminEmails,
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
      ttlMs: infrastructure.latch.ttlMs,
      maxUsers: infrastructure.latch.maxUsers,
      now: infrastructure.latch.now,
    });
    const isLatched = latch.gate();
    const emails = IdentityEmailService.create(setup.repositories.heads, isLatched);
    const identity = IdentityService.create(identityGuards, infrastructure.ledger);
    const verification = VerificationCeremonyService.create({
      store: setup.repositories.verification,
      heads: setup.repositories.heads,
      identity,
      deps: { isLatched },
    });
    const newbornSweep = IdentityNewbornReconciliationService.create({
      newborns: setup.repositories.newborn,
      identity,
      reservations,
    });
    const secrets = IdentitySecretCarryService.create(infrastructure.secrets);
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
    // One answer to "is there a way back in", shared: activation's second
    // precondition and the setup sign-in exemption must not disagree.
    const breakGlass = RequiresLocalDoorAndBinding.create({
      localDoor: LocalDoorBreakGlassBindingRepository.create(),
      bindings: SsoBreakGlassRecoveryService.create({ bindings: setup.repositories.ssoBreakGlass }),
    });
    const ssoConnectionReads = OrganizationSsoConnectionsService.create({
      connections: setup.repositories.ssoConnections,
    });
    // One connection service: the back office, the setup journey and the teardown timer share it.
    const ssoConnectionGraph = composeSsoConnectionGraph({
      repositories: setup.repositories,
      eventSourcing: setup.members.eventing,
      directoryMove: SsoConnectionDirectoryMoveService.create({
        connections: ssoConnectionReads,
        scim: setup.dependencies.scim,
      }),
      engineProvider: engineProviders,
    });
    const ssoConnectionGuards = ssoConnectionGraph.guards;
    const ssoConnections: SsoConnectionService | null = ssoConnectionGraph.connections;
    const ssoConnectionHistory = infrastructure.ssoConnectionHistory
      ? SsoConnectionHistoryService.create({ history: infrastructure.ssoConnectionHistory })
      : null;
    const ssoBackoffice =
      ssoConnections && ssoConnectionHistory
        ? SsoConnectionBackofficeService.create({
            reads: setup.repositories.ssoBackoffice,
            connections: () => ssoConnections,
            history: () => ssoConnectionHistory,
          })
        : null;
    const ssoIssuers = SsoIssuerDirectoryService.create({
      connections: setup.repositories.ssoConnections,
    });
    // The ceremony and the sweep read the SAME published evidence where it
    // lives, so they share one pair of live channels rather than each
    // deciding for itself where a customer's proof is read from.
    const domainProofChannels = ssoConnections
      ? {
          proofs: ssoDomainProofChannels.live.create({
            nameservers: setup.config.ssoDomainProofDnsServers,
          }),
          files: ssoDomainProofFileChannels.live.create({
            policy: SSO_DOMAIN_PROOF_PUBLIC_EGRESS,
          }),
        }
      : null;
    const ssoDomainCeremony =
      ssoConnections && domainProofChannels
        ? SsoDomainCeremonyService.create({
            connections: () => ssoConnections,
            reads: setup.repositories.ssoConnections,
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
    });
    const joinRequests = JoinRequestsService.create({
      requests: JoinRequestService.create(joinRequestGuards, infrastructure.joinRequestLedger),
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
      rateLimit: joinRateLimit(setup.members.rateLimiter),
    });
    // `notifications` is unanswered on purpose: an automatic admission's
    // durable notice needs a mail this process does not compose.
    const ssoArrival = SsoArrivalService.create({
      joinRequests,
      connections: setup.repositories.ssoConnections,
      memberships: arrivalMemberships(setup.dependencies.organizations),
      authz: setup.dependencies.permissions,
      adoption: SsoArrivalAdoptionService.create(backfill),
    });
    const ssoTestArrival = SsoTestArrivalService.create({
      accounts: testArrivalAccounts(setup.dependencies.auth),
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
    const legacyAccess = legacySsoAccess(setup.dependencies.auth);
    // `directory` is unanswered here: whether provisioning has been repointed
    // is the directory module's to say, and an installation without one
    // provisions nobody — which is what `not-applicable` means.
    const ssoMigrationProgress = SsoMigrationProgressService.create({
      connections: setup.repositories.ssoConnections,
      evidence: setup.repositories.ssoMigrationEvidence,
      breakGlass: setup.repositories.ssoBreakGlass,
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
          credentials: setup.repositories.ssoCredentials,
          registrations: SsoIdpRegistrationService.create({
            // The same fence the published-proof reads go through: an issuer
            // is a string an administrator typed.
            discovery: ssoIssuerDiscoveryChannels.live.create({
              policy: SSO_DOMAIN_PROOF_PUBLIC_EGRESS,
              // Auth owns the operator's IdP allowlist; asked per discovery, not at boot.
              dialableInternalOrigins: () =>
                setup.dependencies.auth.findDialableIdentityProviderOrigins(),
            }),
          }),
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
      warnings: LoggedSsoBreakGlassWarningChannel.create(),
      newBindingId: newSsoBreakGlassBindingId,
      directory: breakGlassDirectory(setup.dependencies.organizations),
      holderIsEligible: breakGlassEligibility(
        setup.dependencies.organizations,
        setup.dependencies.users,
      ),
    });
    const ssoSetup = SsoSetupService.create({
      connections: setup.repositories.ssoConnections,
      breakGlass: setup.repositories.ssoBreakGlass,
      activity: setup.repositories.ssoMigrationEvidence,
      migrations: ssoMigrationProgress,
    });
    const scimSyncGuards = ScimSyncGuardsService.create({ syncs: infrastructure.scimSyncs });
    const scimSyncReads = ScimSyncReadsService.create({
      syncs: infrastructure.scimSyncs,
      activity: infrastructure.scimSyncActivity,
    });
    const auth = setup.dependencies.auth;
    const resolveAuthProvider = () => auth.resolveAuthProvider();
    // Main's router (identity/runtime.ts): projected connections, the method policy, one
    // per-process break-glass budget, and the projection-first account lookup.
    const signInRouter = SignInRouterService.create({
      domains: SsoConnectionRoutingService.create({
        connections: setup.repositories.ssoConnectionRouting,
        dial: ssoMethodDialWith({
          mountedMethods: async () =>
            (await SignInMethodPolicyService.findFederatedMethods(resolveAuthProvider)).map(
              (method) => method.id,
            ),
          engineHoldsProvider: (args) =>
            setup.repositories.ssoEngineProviders.findRegisteredProvider(args),
        }),
      }),
      policy: SignInMethodPolicyService.create({
        resolveAuthProvider,
        federationLicensed: () => setup.dependencies.licensing.isPlatformSsoLicensed(),
        offersPasskeys: () => auth.offersPasskeys(),
        issuesOwnPasswords: () => auth.issuesOwnPasswords(),
        selfHosted: () => !setup.members.isSaas,
      }),
      breakGlass: InProcessBreakGlassLimiterService.create(),
      accounts: SignInAccountLookupService.create({
        heads: setup.repositories.heads,
        legacy: setup.repositories.signInAccounts,
        isLatched,
      }),
    });

    return new IdentityApp({
      emails,
      identityGuards,
      mfaGuards,
      reservations,
      identity,
      verification,
      accountIdentifiers: AccountIdentifiersService.create({
        heads: setup.repositories.heads,
        identity,
        ceremony: verification,
        mail: addressConfirmationMailChannels.ses.create({
          mailer: setup.members.mail,
          baseUrl: setup.members.publicBaseUrl ?? "",
        }),
        rateLimiter: setup.members.rateLimiter,
        sessions: setup.dependencies.auth,
      }),
      newbornSweep,
      backfill,
      secrets,
      joinRequestGuards,
      ssoConnections,
      ssoConnectionGuards,
      ssoBackoffice,
      ssoConnectionHistory,
      ssoConnectionReads,
      ssoIssuers,
      ssoDomainCeremony,
      ssoDomainReproof,
      ssoAssertion,
      ssoArrival,
      ssoTestArrival,
      joinAdmissions: JoinAdmissionsService.create(setup.repositories.joinRequests),
      joinRequests,
      ssoActivity,
      ssoMigrationCallbacks,
      ssoBreakGlass: ssoBreakGlassGrants,
      ssoSetup,
      ssoSetupCommands,
      scimSyncGuards,
      scimSyncReads,
      lookup: IdentityLookupService.create({
        reads: setup.repositories.identityLookup,
        history: setup.repositories.identityHistory,
        router: setup.dependencies.auth,
        identity: () => identity,
        links: LinkProposalService.create({
          guards: LinkProposalGuardsService.create({
            proposals: setup.repositories.identityHistory,
          }),
          ledger: infrastructure.ledger,
          proposals: setup.repositories.identityHistory,
          accounts: setup.dependencies.auth,
        }),
        platformOperators: setup.repositories.ssoPlatformOperators,
        auditLog: setup.dependencies.auditLog,
        rateLimiter: setup.members.rateLimiter,
        sessions: setup.dependencies.auth,
        invitations: setup.dependencies.organizations,
      }),
      twoStepAccounts: TwoStepAccountService.create({
        accounts: setup.repositories.twoStepVerification,
        deployment: setup.dependencies.auth,
        protocol: setup.dependencies.auth,
      }),
      organizationMfa: OrganizationMfaService.create({
        accounts: setup.repositories.twoStepVerification,
        auth: setup.dependencies.auth,
        notifier: OrganizationMfaNotifierService.create({
          accounts: setup.repositories.twoStepVerification,
          mail: organizationMfaRequirementMailChannels.ses.create({ mailer: setup.members.mail }),
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
        producer: IdentityProducerPipelines.create({ processName: "identity" }),
        identity: () => composeIdentityPipeline({ repositories: setup.repositories }),
        joinRequests: () =>
          composeJoinRequestPipeline({
            repositories: setup.repositories,
            eventSourcing: setup.members.eventing,
            notifier: JoinRequestNotifierService.create({
              audience: setup.repositories.joinRequestAudience,
              context: setup.repositories.joinRequestNotificationContext,
              mail: joinRequestNotificationMailChannels.ses.create({
                mailer: setup.members.mail,
                baseUrl: setup.members.publicBaseUrl ?? "",
              }),
              baseHost: setup.members.publicBaseUrl ?? "",
              plans: setup.dependencies.entitlements,
            }),
          }),
        scimSync: () => composeScimSyncPipeline(setup.repositories),
        ssoConnections: ssoConnectionGraph.pipeline,
      },
    });
  }

  identityPipeline({ participation }: { participation: EventingParticipation }): IdentityPipeline {
    const pipelines = this.#parts.pipelines;
    return participation === "produce"
      ? pipelines.producer.identityPipeline()
      : pipelines.identity();
  }

  joinRequestPipeline({
    participation,
  }: {
    participation: EventingParticipation;
  }): JoinRequestPipeline {
    const pipelines = this.#parts.pipelines;
    return participation === "produce"
      ? pipelines.producer.joinRequestPipeline()
      : pipelines.joinRequests();
  }

  scimSyncPipeline({ participation }: { participation: EventingParticipation }): ScimSyncPipeline {
    const pipelines = this.#parts.pipelines;
    return participation === "produce"
      ? pipelines.producer.scimSyncPipeline()
      : pipelines.scimSync();
  }

  ssoConnectionPipeline({
    participation,
  }: {
    participation: EventingParticipation;
  }): SsoConnectionPipeline {
    const pipelines = this.#parts.pipelines;
    return participation === "produce"
      ? pipelines.producer.ssoConnectionPipeline()
      : pipelines.ssoConnections();
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

  removeIdentifier(input: { userId: string; identifierId: string }): Promise<void> {
    return this.#parts.accountIdentifiers.removeIdentifier(input);
  }

  routeSignIn(
    input: Readonly<{ identifier: string | null; breakGlass: boolean }>,
  ): Promise<RoutingDecision> {
    return this.#parts.signInRouter.route(input);
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

  newbornSweep(): IdentityNewbornReconciliationService {
    return this.#parts.newbornSweep;
  }

  userMigrations(): readonly SystemMigration[] {
    return [
      IdentityIdentifierBackfillMigrationService.create(this.#parts.backfill),
      IdentitySecretHealMigrationService.create(this.#parts.secrets),
    ] as const;
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

  ssoBackoffice(): SsoConnectionBackofficeService {
    if (!this.#parts.ssoBackoffice) {
      throw new IdentityCapabilityUnavailableError("SSO connection backoffice");
    }
    return this.#parts.ssoBackoffice;
  }

  ssoConnectionHistory(): SsoConnectionHistoryService {
    if (!this.#parts.ssoConnectionHistory) {
      throw new IdentityCapabilityUnavailableError("SSO connection history");
    }
    return this.#parts.ssoConnectionHistory;
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

  scimSyncGuards(): ScimSyncGuardsService {
    return this.#parts.scimSyncGuards;
  }

  scimSyncReads(): ScimSyncReadsService {
    return this.#parts.scimSyncReads;
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
}
