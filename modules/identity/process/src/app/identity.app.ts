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
import { EntitlementApi, isEnterpriseTier } from "@langwatch/entitlement-contract";
import {
  IdentityApi,
  IdentityCapabilityUnavailableError,
  identityConfig,
  sealedProviderConfigCipher,
  type IdentityServerConfig,
} from "@langwatch/identity-contract";
import type { FeatureSetup } from "@langwatch/kernel";
import { OrganizationApi } from "@langwatch/organization-contract";
import { reads, type MembersRead, type RateLimiter } from "@langwatch/process-stores/members";
import type { SystemMigration } from "@langwatch/system-migrations";
import { Temporal, nowInstant } from "@langwatch/time";
import { UserApi } from "@langwatch/user-contract";

import { LoggedSsoBreakGlassWarningChannel } from "../channels/sso-break-glass-warning.channel.ts";
import {
  ssoDomainProofChannels,
  ssoDomainProofFileChannels,
} from "../channels/sso-domain-proof-channels.registry.ts";
import { SSO_DOMAIN_PROOF_PUBLIC_EGRESS } from "../channels/sso-domain-proof-file.channel.ts";
import { ssoIssuerDiscoveryChannels } from "../channels/sso-issuer-discovery-channels.registry.ts";
import type { IdentityRepositories } from "../repositories/identity.repositories.ts";
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
import { CryptoIdentifierIdentityAdapter } from "../services/crypto-identifier-identity.service.ts";
import { IdentityBackfillPlanService } from "../services/identity-backfill-plan.service.ts";
import { IdentityBackfillService } from "../services/identity-backfill.service.ts";
import { IdentityEmailService } from "../services/identity-email.service.ts";
import { IdentityGuardsService } from "../services/identity-guards.service.ts";
import {
  IDENTITY_NEWBORN_ABANDONED_AFTER_MS,
  IdentityNewbornReconciliationService,
} from "../services/identity-newborn-reconciliation.service.ts";
import { IdentitySecretCarryService } from "../services/identity-secret-carry.service.ts";
import { IdentityService } from "../services/identity.service.ts";
import { JoinAdmissionsService } from "../services/join-admissions.service.ts";
import { JoinRequestGuardsService } from "../services/join-request-guards.service.ts";
import { JoinRequestNotificationService } from "../services/join-request-notification.service.ts";
import { JoinRequestService } from "../services/join-request.service.ts";
import { JoinRequestsService } from "../services/join-requests.service.ts";
import { LocalDoorBreakGlassBindingAdapter } from "../services/local-door-break-glass-binding.service.ts";
import { MfaGuardsService } from "../services/mfa-guards.service.ts";
import { OrganizationSsoConnectionsService } from "../services/organization-sso-connections.service.ts";
import { CachedIdentityLatch } from "../services/per-subject-cached-latch.service.ts";
import { ScimSyncGuardsService } from "../services/scim-sync-guards.service.ts";
import { ScimSyncReadsService } from "../services/scim-sync-reads.service.ts";
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
import { SsoConnectionGuardsService } from "../services/sso-connection-guards.service.ts";
import { SsoConnectionHistoryService } from "../services/sso-connection-history.service.ts";
import { SsoConnectionService } from "../services/sso-connection.service.ts";
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
import { IdentityIdentifierBackfillMigrationAdapter } from "../services/system-migration-identity-identifier-backfill.service.ts";
import { IdentitySecretHealMigrationAdapter } from "../services/system-migration-identity-secret-heal.service.ts";
import { VerificationCeremonyService } from "../services/verification-ceremony.service.ts";
import { buildIdentityInfrastructure } from "./identity-composition.build.ts";
/**
 * The boundary `reservations().reapOrphans()` call takes no args, so it bounds
 * itself per pass the same way `IdentityNewbornReconciliationService`'s own
 * internal reap of this exact repository call does.
 */
const RESERVATIONS_REAP_LIMIT_PER_PASS = 200;
/**
 * `registersPipelines` is the composition's own word — which process
 * produces the four identity pipelines — never a deployment's; unresolved,
 * see the handoff. Default preserves the deleted schema's producer-role default.
 */
type IdentityMembers = MembersRead<readonly ["prisma", "eventing", "encryption", "rateLimiter"]> &
  Readonly<{
    /** LangWatch's own cloud: what licenses federation, and so automatic joining. */
    isSaas: boolean;
    producesPipelines: boolean;
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
  newbornSweep: IdentityNewbornReconciliationService;
  backfill: IdentityBackfillService;
  secrets: IdentitySecretCarryService;
  joinRequestGuards: JoinRequestGuardsService;
  joinRequestNotifications: JoinRequestNotificationService | null;
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
    joiningChanged: ({ organizationId, actorUserId, change }) =>
      auditLog.record({
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
      }),
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

export class IdentityApp implements IdentityApi {
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
  };
  /** `registersPipelines` is named raw so the process can answer it through
   * `withMember`/`withMembers` (see {@link IdentityMembers}). */
  static readonly reads = [
    ...reads("prisma", "eventing", "encryption", "rateLimiter"),
    "isSaas",
    "producesPipelines",
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
    const infrastructure = buildIdentityInfrastructure({
      prisma: setup.members.prisma,
      eventing: setup.members.eventing,
      adminEmails: setup.members.adminEmails,
      registersPipelines: setup.members.producesPipelines,
      engineProvider: engineProviders,
    });
    const reservations = setup.repositories.reservations;
    const identityGuards = IdentityGuardsService.create({
      heads: setup.repositories.heads,
      users: setup.repositories.users,
      reservations,
      identifiers: CryptoIdentifierIdentityAdapter.create(),
    });
    const mfaGuards = MfaGuardsService.create(setup.repositories.mfaEnrollment);
    const latch = CachedIdentityLatch.create({
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
      plan: IdentityBackfillPlanService.create(CryptoIdentifierIdentityAdapter.create()),
    });
    const joinRequestGuards = JoinRequestGuardsService.create({
      requests: setup.repositories.joinRequests,
    });
    const joinRequestNotifications = infrastructure.mail
      ? JoinRequestNotificationService.create({
          audience: infrastructure.joinRequestAudience,
          mail: infrastructure.mail,
        })
      : null;
    // One answer to "is there a way back in", shared: activation's second
    // precondition and the setup sign-in exemption must not disagree.
    const breakGlass = RequiresLocalDoorAndBinding.create({
      localDoor: LocalDoorBreakGlassBindingAdapter.create(),
      bindings: SsoBreakGlassRecoveryService.create({ bindings: setup.repositories.ssoBreakGlass }),
    });
    const ssoConnectionGuards = SsoConnectionGuardsService.create({
      connections: setup.repositories.ssoConnections,
      registrationSlots: setup.repositories.ssoRegistrationSlots,
      breakGlass,
      stranding: setup.repositories.ssoStranding,
      platformOperators: infrastructure.ssoPlatformOperators,
    });
    // Q3(c): the ledger is nullable exactly like `mail`; without it neither
    // capability has a store to write through, so both refuse by name.
    const ssoConnections = infrastructure.ssoConnectionLedger
      ? SsoConnectionService.create(ssoConnectionGuards, infrastructure.ssoConnectionLedger)
      : null;
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
    const ssoConnectionReads = OrganizationSsoConnectionsService.create({
      connections: setup.repositories.ssoConnections,
    });
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
    const scimSyncReads = ScimSyncReadsService.create({ syncs: infrastructure.scimSyncs });

    return new IdentityApp({
      emails,
      identityGuards,
      mfaGuards,
      reservations,
      identity,
      verification,
      newbornSweep,
      backfill,
      secrets,
      joinRequestGuards,
      joinRequestNotifications,
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
    });
  }

  readonly #parts: IdentityAppParts;

  private constructor(parts: IdentityAppParts) {
    this.#parts = parts;
  }

  findEmail(input: { userId: string }): Promise<string | null> {
    return this.#parts.emails.tryResolveEmail(input);
  }

  verifiedEmailsOf(input: { userId: string }) {
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

  guards(): IdentityGuardsService {
    return this.#parts.identityGuards;
  }

  mfaGuards(): MfaGuardsService {
    return this.#parts.mfaGuards;
  }

  reservations() {
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
      IdentityIdentifierBackfillMigrationAdapter.create(this.#parts.backfill),
      IdentitySecretHealMigrationAdapter.create(this.#parts.secrets),
    ] as const;
  }

  joinRequestGuards(): JoinRequestGuardsService {
    return this.#parts.joinRequestGuards;
  }

  joinRequestNotifications(): JoinRequestNotificationService | null {
    return this.#parts.joinRequestNotifications;
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
}
