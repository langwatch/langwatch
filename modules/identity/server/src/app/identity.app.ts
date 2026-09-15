/**
 * The identity feature's application: the guards, the ledger writer, the
 * backfill pass, the newborn sweep, the join-request and SSO-connection
 * guards, and the directory-sync guards - every capability that crosses a
 * package boundary today (`IdentityApi`, ADR-101, ADR-115, ADR-116, ADR-117).
 */
import { IdentityApi, IdentityCapabilityUnavailableError } from "@langwatch/identity-contract";
import type { FeatureSetup } from "@langwatch/runtime-composition";
import { reads, type MembersRead } from "@langwatch/infrastructure/members";
import { Temporal, nowInstant } from "@langwatch/time";
import { z } from "zod";
import { buildIdentityInfrastructure } from "./identity-composition.build.ts";
import { CryptoIdentifierIdentityAdapter } from "../services/crypto-identifier-identity.service.ts";
import { LocalDoorBreakGlassBindingAdapter } from "../services/local-door-break-glass-binding.service.ts";
import type { IdentityRepositories } from "../repositories/identity.repositories.ts";
import { CachedIdentityLatch } from "../services/per-subject-cached-latch.service.ts";
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
import { MfaGuardsService } from "../services/mfa-guards.service.ts";
import { ScimSyncGuardsService } from "../services/scim-sync-guards.service.ts";
import { SsoConnectionBackofficeService } from "../services/sso-connection-backoffice.service.ts";
import { SsoConnectionGuardsService } from "../services/sso-connection-guards.service.ts";
import { SsoConnectionService } from "../services/sso-connection.service.ts";
import { IdentityIdentifierBackfillMigrationAdapter } from "../services/system-migration-identity-identifier-backfill.service.ts";
import { IdentitySecretHealMigrationAdapter } from "../services/system-migration-identity-secret-heal.service.ts";
/**
 * The boundary `reservations().reapOrphans()` call takes no args, so it bounds
 * itself per pass the same way `IdentityNewbornReconciliationService`'s own
 * internal reap of this exact repository call does.
 */
const RESERVATIONS_REAP_LIMIT_PER_PASS = 200;
/**
 * Config schema: `ADMIN_EMAILS`, the deployment's platform-operator list, for
 * the SSO connection guards' D05 tier-1 check. Defaults to none rather than
 * refusing at boot, because a process that composes no operators still
 * composes every other identity capability.
 */
const identityAppConfigSchema = z.object({
  adminEmails: z.array(z.string()).default([]),
  /**
   * Whether this process registers the four identity pipelines (the
   * producer role, default `true`). A draining process sets `false`, since
   * one runtime holds one registration and senders resolve off it at first send.
   */
  registersPipelines: z.boolean().default(true),
});
export type IdentityAppConfig = z.infer<typeof identityAppConfigSchema>;

type IdentitySetup = FeatureSetup<
  Record<string, never>,
  MembersRead<typeof IdentityApp.reads>,
  IdentityAppConfig
> &
  Readonly<{ repositories: IdentityRepositories }>;

export class IdentityApp implements IdentityApi {
  static readonly contract = IdentityApi;
  static readonly dependencies = {};
  static readonly configSchema = identityAppConfigSchema;
  static readonly reads = reads("prisma", "eventing");

  static create(setup: IdentitySetup): IdentityApp {
    const infrastructure = buildIdentityInfrastructure({
      prisma: setup.members.prisma,
      eventing: setup.members.eventing,
      config: setup.config,
    });
    const reservations = setup.repositories.reservations;
    const identityGuards = IdentityGuardsService.create(
      setup.repositories.heads,
      setup.repositories.users,
      reservations,
      CryptoIdentifierIdentityAdapter.create(),
    );
    const mfaGuards = MfaGuardsService.create(setup.repositories.mfaEnrollment);
    const emails = IdentityEmailService.create(
      setup.repositories.heads,
      CachedIdentityLatch.create({
        repository: setup.repositories.latch,
        ttlMs: infrastructure.latch.ttlMs,
        maxUsers: infrastructure.latch.maxUsers,
        now: infrastructure.latch.now,
      }).gate(),
    );
    const identity = IdentityService.create(identityGuards, infrastructure.ledger);
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
    const ssoConnectionGuards = SsoConnectionGuardsService.create({
      connections: setup.repositories.ssoConnections,
      breakGlass: LocalDoorBreakGlassBindingAdapter.create(),
      stranding: setup.repositories.ssoStranding,
      platformOperators: infrastructure.ssoPlatformOperators,
    });
    // Q3(c): the ledger is nullable exactly like `mail`; without it neither
    // capability has a store to write through, so both refuse by name.
    const ssoConnections = infrastructure.ssoConnectionLedger
      ? SsoConnectionService.create(ssoConnectionGuards, infrastructure.ssoConnectionLedger)
      : null;
    const ssoBackoffice = ssoConnections
      ? SsoConnectionBackofficeService.create({
          reads: setup.repositories.ssoBackoffice,
          connections: () => ssoConnections,
        })
      : null;
    const scimSyncGuards = ScimSyncGuardsService.create({ syncs: infrastructure.scimSyncs });

    return new IdentityApp({
      emails,
      identityGuards,
      mfaGuards,
      reservations,
      identity,
      newbornSweep,
      backfill,
      secrets,
      joinRequestGuards,
      joinRequestNotifications,
      ssoConnections,
      ssoConnectionGuards,
      ssoBackoffice,
      scimSyncGuards,
    });
  }

  private constructor(
    private readonly parts: {
      emails: IdentityEmailService;
      identityGuards: IdentityGuardsService;
      mfaGuards: MfaGuardsService;
      reservations: IdentityRepositories["reservations"];
      identity: IdentityService;
      newbornSweep: IdentityNewbornReconciliationService;
      backfill: IdentityBackfillService;
      secrets: IdentitySecretCarryService;
      joinRequestGuards: JoinRequestGuardsService;
      joinRequestNotifications: JoinRequestNotificationService | null;
      ssoConnections: SsoConnectionService | null;
      ssoConnectionGuards: SsoConnectionGuardsService;
      ssoBackoffice: SsoConnectionBackofficeService | null;
      scimSyncGuards: ScimSyncGuardsService;
    },
  ) {}

  findEmail(input: { userId: string }): Promise<string | null> {
    return this.parts.emails.tryResolveEmail(input);
  }

  verifiedEmailsOf(input: { userId: string }) {
    return this.parts.emails.tryVerifiedEmailsOf(input);
  }

  guards(): IdentityGuardsService {
    return this.parts.identityGuards;
  }

  mfaGuards(): MfaGuardsService {
    return this.parts.mfaGuards;
  }

  reservations() {
    const reservations = this.parts.reservations;
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
    return this.parts.identity;
  }

  newbornSweep(): IdentityNewbornReconciliationService {
    return this.parts.newbornSweep;
  }

  userMigrations() {
    return [
      IdentityIdentifierBackfillMigrationAdapter.create(this.parts.backfill),
      IdentitySecretHealMigrationAdapter.create(this.parts.secrets),
    ] as const;
  }

  joinRequestGuards(): JoinRequestGuardsService {
    return this.parts.joinRequestGuards;
  }

  joinRequestNotifications(): JoinRequestNotificationService | null {
    return this.parts.joinRequestNotifications;
  }

  ssoConnections(): SsoConnectionService {
    if (!this.parts.ssoConnections) {
      throw new IdentityCapabilityUnavailableError("SSO connection store");
    }
    return this.parts.ssoConnections;
  }

  ssoConnectionGuards(): SsoConnectionGuardsService {
    return this.parts.ssoConnectionGuards;
  }

  ssoBackoffice(): SsoConnectionBackofficeService {
    if (!this.parts.ssoBackoffice) {
      throw new IdentityCapabilityUnavailableError("SSO connection backoffice");
    }
    return this.parts.ssoBackoffice;
  }

  scimSyncGuards(): ScimSyncGuardsService {
    return this.parts.scimSyncGuards;
  }
}
