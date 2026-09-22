/**
 * The identity feature's application: guards, ledger writer, backfill,
 * newborn sweep, join-request/SSO-connection/directory-sync guards — every
 * capability crossing a package boundary today (ADR-101, 115, 116, 117).
 */
import { AuthzApi } from "@langwatch/authz-contract";
import {
  IdentityApi,
  IdentityCapabilityUnavailableError,
  identityConfig,
  type IdentityServerConfig,
} from "@langwatch/identity-contract";
import type { FeatureSetup } from "@langwatch/kernel";
import { OrganizationApi } from "@langwatch/organization-contract";
import { reads, type MembersRead } from "@langwatch/process-stores/members";
import { Temporal, nowInstant } from "@langwatch/time";

import {
  ssoDomainProofChannels,
  ssoDomainProofFileChannels,
} from "../channels/sso-domain-proof-channels.registry.ts";
import { SSO_DOMAIN_PROOF_PUBLIC_EGRESS } from "../channels/sso-domain-proof-file.channel.ts";
import { ssoIssuerDiscoveryChannels } from "../channels/sso-issuer-discovery-channels.registry.ts";
import type { IdentityRepositories } from "../repositories/identity.repositories.ts";
import type { SsoArrivalMemberships } from "../rules/sso-arrival-contract.rules.ts";
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
import { JoinRequestGuardsService } from "../services/join-request-guards.service.ts";
import { JoinRequestNotificationService } from "../services/join-request-notification.service.ts";
import { LocalDoorBreakGlassBindingAdapter } from "../services/local-door-break-glass-binding.service.ts";
import { MfaGuardsService } from "../services/mfa-guards.service.ts";
import { OrganizationSsoConnectionsService } from "../services/organization-sso-connections.service.ts";
import { CachedIdentityLatch } from "../services/per-subject-cached-latch.service.ts";
import { ScimSyncGuardsService } from "../services/scim-sync-guards.service.ts";
import { SsoArrivalAdoptionService } from "../services/sso-arrival-adoption.service.ts";
import { SsoArrivalService } from "../services/sso-arrival.service.ts";
import { SsoAssertionService } from "../services/sso-assertion.service.ts";
import { SsoConnectionBackofficeService } from "../services/sso-connection-backoffice.service.ts";
import { SsoConnectionGuardsService } from "../services/sso-connection-guards.service.ts";
import { SsoConnectionHistoryService } from "../services/sso-connection-history.service.ts";
import { SsoConnectionService } from "../services/sso-connection.service.ts";
import { SsoDomainCeremonyService } from "../services/sso-domain-ceremony.service.ts";
import { SsoDomainReproofService } from "../services/sso-domain-reproof.service.ts";
import { SsoIdpRegistrationService } from "../services/sso-idp-registration.service.ts";
import { SsoRegistrantReadsService } from "../services/sso-registrant-reads.service.ts";
import { SsoSetupCommandsService } from "../services/sso-setup-commands.service.ts";
import { SsoSetupService } from "../services/sso-setup.service.ts";
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
type IdentityMembers = MembersRead<readonly ["prisma", "eventing"]> &
  Readonly<{ producesPipelines: boolean; adminEmails: readonly string[] }>;

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
  ssoDomainCeremony: SsoDomainCeremonyService | null;
  ssoDomainReproof: SsoDomainReproofService | null;
  ssoAssertion: SsoAssertionService;
  ssoArrival: SsoArrivalService;
  ssoSetup: SsoSetupService;
  ssoSetupCommands: SsoSetupCommandsService | null;
  scimSyncGuards: ScimSyncGuardsService;
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

export class IdentityApp implements IdentityApi {
  static readonly contract = IdentityApi;
  static readonly config = identityConfig;
  /** The two peers an admission orchestrates: the module that owns
   *  membership rows, and the one that owns the pending-admission marker. */
  static readonly dependencies = { organizations: OrganizationApi, permissions: AuthzApi };
  /** `registersPipelines` is named raw so the process can answer it through
   * `withMember`/`withMembers` (see {@link IdentityMembers}). */
  static readonly reads = [
    ...reads("prisma", "eventing"),
    "producesPipelines",
    "adminEmails",
  ] as const;

  static create(setup: IdentitySetup): IdentityApp {
    const infrastructure = buildIdentityInfrastructure({
      prisma: setup.members.prisma,
      eventing: setup.members.eventing,
      adminEmails: setup.members.adminEmails,
      registersPipelines: setup.members.producesPipelines,
    });
    const reservations = setup.repositories.reservations;
    const identityGuards = IdentityGuardsService.create(
      setup.repositories.heads,
      setup.repositories.users,
      reservations,
      CryptoIdentifierIdentityAdapter.create(),
    );
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
    const verification = VerificationCeremonyService.create(
      setup.repositories.verification,
      setup.repositories.heads,
      identity,
      { isLatched },
    );
    const newbornSweep = IdentityNewbornReconciliationService.create({
      newborns: setup.repositories.newborn,
      identity,
      reservations,
    });
    const secrets = IdentitySecretCarryService.create(infrastructure.secrets);
    const backfill = IdentityBackfillService.create(
      setup.repositories.backfill,
      setup.repositories.users,
      identity,
      secrets,
      IdentityBackfillPlanService.create(CryptoIdentifierIdentityAdapter.create()),
    );
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
    const breakGlass = LocalDoorBreakGlassBindingAdapter.create();
    const ssoConnectionGuards = SsoConnectionGuardsService.create({
      connections: setup.repositories.ssoConnections,
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
    // `joinRequests` and `notifications` are unanswered here on purpose: both
    // are the composition root's (see the handoff), and an arrival on a
    // connection that ASKS admits nobody until they are supplied.
    const ssoArrival = SsoArrivalService.create({
      connections: setup.repositories.ssoConnections,
      memberships: arrivalMemberships(setup.dependencies.organizations),
      authz: setup.dependencies.permissions,
      adoption: SsoArrivalAdoptionService.create(backfill),
    });
    // Q3(c) again: without the connection ledger there is nothing to press
    // against, so the journey's verbs refuse by name rather than half-work.
    const ssoSetupCommands = ssoConnections
      ? SsoSetupCommandsService.create({
          connections: () => ssoConnections,
          reads: setup.repositories.ssoConnections,
          credentials: setup.repositories.ssoCredentials,
          registrations: SsoIdpRegistrationService.create({
            // The same fence the published-proof reads go through: an issuer
            // is a string an administrator typed.
            discovery: ssoIssuerDiscoveryChannels.live.create({
              policy: SSO_DOMAIN_PROOF_PUBLIC_EGRESS,
            }),
          }),
        })
      : null;
    const ssoSetup = SsoSetupService.create({
      connections: setup.repositories.ssoConnections,
      breakGlass: setup.repositories.ssoBreakGlass,
    });
    const scimSyncGuards = ScimSyncGuardsService.create({ syncs: infrastructure.scimSyncs });

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
      ssoDomainCeremony,
      ssoDomainReproof,
      ssoAssertion,
      ssoArrival,
      ssoSetup,
      ssoSetupCommands,
      scimSyncGuards,
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

  userMigrations() {
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

  ssoSetup(): SsoSetupService {
    return this.#parts.ssoSetup;
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
}
