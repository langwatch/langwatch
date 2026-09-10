/**
 * The identity feature's application: the guards, the ledger writer, the
 * backfill pass, the newborn sweep, the join-request and SSO-connection
 * guards, and the directory-sync guards - every capability that crosses a
 * package boundary today (`IdentityApi`, ADR-101, ADR-115, ADR-116, ADR-117).
 */
import { IdentityApi } from "@langwatch/identity-contract";
import type { FeatureSetup } from "@langwatch/runtime-composition";
import { CryptoIdentifierIdentityAdapter } from "../adapters/crypto.identifier-identity.adapter.ts";
import { LocalDoorBreakGlassBindingAdapter } from "../adapters/local-door-break-glass-binding.adapter.ts";
import type { IdentityRepositories } from "../repositories/identity.repositories.ts";
import { CachedIdentityLatch } from "../services/per-subject-cached-latch.service.ts";
import { IdentityBackfillPlanService } from "../services/identity-backfill-plan.service.ts";
import { IdentityBackfillService } from "../services/identity-backfill.service.ts";
import { IdentityEmailService } from "../services/identity-email.service.ts";
import { IdentityGuardsService } from "../services/identity-guards.service.ts";
import { IdentityNewbornReconciliationService } from "../services/identity-newborn-reconciliation.service.ts";
import { IdentitySecretCarryService } from "../services/identity-secret-carry.service.ts";
import { IdentityService } from "../services/identity.service.ts";
import { JoinRequestGuardsService } from "../services/join-request-guards.service.ts";
import { JoinRequestNotificationService } from "../services/join-request-notification.service.ts";
import { MfaGuardsService } from "../services/mfa-guards.service.ts";
import { ScimSyncGuardsService } from "../services/scim-sync-guards.service.ts";
import { SsoConnectionBackofficeService } from "../services/sso-connection-backoffice.service.ts";
import { SsoConnectionGuardsService } from "../services/sso-connection-guards.service.ts";
import { SsoConnectionService } from "../services/sso-connection.service.ts";
import { IdentityIdentifierBackfillMigrationAdapter } from "../adapters/system-migration.identity-identifier-backfill.adapter.ts";
import { IdentitySecretHealMigrationAdapter } from "../adapters/system-migration.identity-secret-heal.adapter.ts";
import type { IdentityInfrastructure } from "./identity-infrastructure.ts";

type IdentitySetup = FeatureSetup<Record<string, never>, IdentityInfrastructure, never> &
  Readonly<{ repositories: IdentityRepositories }>;

export class IdentityApp implements IdentityApi {
  static readonly contract = IdentityApi;
  static readonly dependencies = {};

  static create(setup: IdentitySetup): IdentityApp {
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
        ttlMs: setup.infrastructure.latch.ttlMs,
        maxUsers: setup.infrastructure.latch.maxUsers,
        now: setup.infrastructure.latch.now,
      }).gate(),
    );
    const identity = IdentityService.create(identityGuards, setup.infrastructure.ledger);
    const newbornSweep = IdentityNewbornReconciliationService.create({
      newborns: setup.repositories.newborn,
      identity,
      reservations,
    });
    const secrets = IdentitySecretCarryService.create(setup.infrastructure.secrets);
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
    const joinRequestNotifications = setup.infrastructure.mail
      ? JoinRequestNotificationService.create({
          audience: setup.infrastructure.joinRequestAudience,
          mail: setup.infrastructure.mail,
        })
      : null;
    const ssoConnectionGuards = SsoConnectionGuardsService.create({
      connections: setup.repositories.ssoConnections,
      breakGlass: LocalDoorBreakGlassBindingAdapter.create(),
      stranding: setup.repositories.ssoStranding,
      platformOperators: setup.infrastructure.ssoPlatformOperators,
    });
    const ssoConnections = SsoConnectionService.create(
      ssoConnectionGuards,
      setup.infrastructure.ssoConnectionLedger,
    );
    const ssoBackoffice = SsoConnectionBackofficeService.create({
      reads: setup.repositories.ssoBackoffice,
      connections: () => ssoConnections,
    });
    const scimSyncGuards = ScimSyncGuardsService.create({ syncs: setup.infrastructure.scimSyncs });

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
      ssoConnections: SsoConnectionService;
      ssoConnectionGuards: SsoConnectionGuardsService;
      ssoBackoffice: SsoConnectionBackofficeService;
      scimSyncGuards: ScimSyncGuardsService;
    },
  ) {}

  findEmail(input: { userId: string }): Promise<string | null> {
    return this.parts.emails.tryResolveEmail(input);
  }

  get guards(): IdentityGuardsService {
    return this.parts.identityGuards;
  }

  get mfaGuards(): MfaGuardsService {
    return this.parts.mfaGuards;
  }

  get reservations(): IdentityRepositories["reservations"] {
    return this.parts.reservations;
  }

  get identity(): IdentityService {
    return this.parts.identity;
  }

  get newbornSweep(): IdentityNewbornReconciliationService {
    return this.parts.newbornSweep;
  }

  userMigrations() {
    return [
      IdentityIdentifierBackfillMigrationAdapter.create(this.parts.backfill),
      IdentitySecretHealMigrationAdapter.create(this.parts.secrets),
    ] as const;
  }

  get joinRequestGuards(): JoinRequestGuardsService {
    return this.parts.joinRequestGuards;
  }

  get joinRequestNotifications(): JoinRequestNotificationService | null {
    return this.parts.joinRequestNotifications;
  }

  get ssoConnections(): SsoConnectionService {
    return this.parts.ssoConnections;
  }

  get ssoConnectionGuards(): SsoConnectionGuardsService {
    return this.parts.ssoConnectionGuards;
  }

  get ssoBackoffice(): SsoConnectionBackofficeService {
    return this.parts.ssoBackoffice;
  }

  get scimSyncGuards(): ScimSyncGuardsService {
    return this.parts.scimSyncGuards;
  }
}
