import {
  SsoConnectionInvalidTransitionError,
  SsoMigrationFinalizationBlockedError,
  type SsoConnectionLifecycleState,
} from "@langwatch/identity-contract";
import { nowInstant } from "@langwatch/time";

import { newSsoConnectionCommandId } from "../rules/sso-connection-id.rules.ts";
import type { SsoConnectionService } from "./sso-connection.service.ts";
import type { SsoLegacyIdentityRetirementService } from "./sso-legacy-identity-retirement.service.ts";
import type {
  SsoMigrationFinalizationEvidence,
  SsoMigrationProgressService,
} from "./sso-migration-progress.service.ts";

export interface SsoMigrationFinalizationServiceDeps {
  connections: () => SsoConnectionService;
  evidence: SsoMigrationProgressService;
  retirement: SsoLegacyIdentityRetirementService;
  now?: () => number;
}

interface FinalizationRequest {
  organizationId: string;
  replacementConnectionId: string;
  actorUserId: string;
}

/**
 * The conservative cutover finish (ADR-117): FINALIZING is the durable
 * callback gate and lands before anything is removed, and every later step
 * re-reads its evidence, so a process that dies mid-way resumes.
 */
export class SsoMigrationFinalizationService {
  static create(deps: SsoMigrationFinalizationServiceDeps): SsoMigrationFinalizationService {
    return new SsoMigrationFinalizationService(deps);
  }

  private readonly now: () => number;

  private constructor(private readonly deps: SsoMigrationFinalizationServiceDeps) {
    this.now = deps.now ?? (() => nowInstant().epochMilliseconds);
  }

  async finalize(request: FinalizationRequest): Promise<void> {
    const evidence = await this.inspect(request);
    if (evidence.phase === "FINALIZED") return;

    this.requireReady(evidence);
    await this.enterFinalizing(request, evidence);
    await this.retireLegacyIdentities(request);
    await this.completeLegacyTeardown(request);
    await this.deps.connections().finalizeMigration(
      this.command({
        organizationId: request.organizationId,
        connectionId: request.replacementConnectionId,
        actorUserId: request.actorUserId,
      }),
    );
  }

  /** The durable gate. A callback arriving after this is refused by the phase
   *  itself, which is why it lands before any identity is touched. */
  private async enterFinalizing(
    request: FinalizationRequest,
    evidence: SsoMigrationFinalizationEvidence,
  ): Promise<void> {
    if (evidence.phase === "GRACE_DIRECT") {
      await this.deps.connections().beginMigrationFinalization(
        this.command({
          organizationId: request.organizationId,
          connectionId: request.replacementConnectionId,
          actorUserId: request.actorUserId,
        }),
      );

      return;
    }
    if (evidence.phase !== "FINALIZING") {
      throw new SsoConnectionInvalidTransitionError(
        `connection ${request.replacementConnectionId}: finalization requires the direct migration route`,
      );
    }
  }

  private async retireLegacyIdentities(request: FinalizationRequest): Promise<void> {
    let evidence = await this.inspect(request);
    this.requireReady(evidence);
    await this.deps.retirement.retire({
      organizationId: request.organizationId,
      legacyConnectionId: evidence.legacyConnectionId,
      replacementConnectionId: request.replacementConnectionId,
      actorUserId: request.actorUserId,
    });

    evidence = await this.inspect(request);
    this.requireReady(evidence);
    if (!evidence.legacyAccessRetired) {
      throw new SsoMigrationFinalizationBlockedError([
        {
          code: "legacy-access-remains",
          message: "Legacy accounts or identifiers remain after the retirement pass.",
        },
      ]);
    }
  }

  private async completeLegacyTeardown(request: FinalizationRequest): Promise<void> {
    let evidence = await this.inspect(request);
    this.requireReady(evidence);
    await this.tearDownLegacy({
      organizationId: request.organizationId,
      legacyConnectionId: evidence.legacyConnectionId,
      legacyState: evidence.legacyState,
      actorUserId: request.actorUserId,
    });

    evidence = await this.inspect(request);
    this.requireReady(evidence);
    if (!evidence.legacyAccessRetired || evidence.legacyState !== "TORN_DOWN") {
      throw new SsoMigrationFinalizationBlockedError([
        {
          code: "legacy-retirement-incomplete",
          message: "The legacy connection has not completed its retirement ceremony.",
        },
      ]);
    }
  }

  private async tearDownLegacy({
    organizationId,
    legacyConnectionId,
    legacyState,
    actorUserId,
  }: {
    organizationId: string;
    legacyConnectionId: string;
    legacyState: SsoConnectionLifecycleState;
    actorUserId: string;
  }): Promise<void> {
    if (legacyState === "TORN_DOWN") return;

    const command = this.command({
      organizationId,
      connectionId: legacyConnectionId,
      actorUserId,
    });
    if (legacyState !== "TEARDOWN_PENDING") {
      await this.deps.connections().requestTeardown({
        ...command,
        reason: "direct-sso-migration-finalized",
        graceMs: 0,
      });
    }

    await this.deps.connections().completeTeardown(command);
  }

  private async inspect({
    organizationId,
    replacementConnectionId,
  }: FinalizationRequest): Promise<SsoMigrationFinalizationEvidence> {
    return this.deps.evidence.getFinalizationEvidence({
      organizationId,
      connectionId: replacementConnectionId,
    });
  }

  private requireReady(evidence: SsoMigrationFinalizationEvidence): void {
    if (evidence.blockers.length > 0) {
      throw new SsoMigrationFinalizationBlockedError(evidence.blockers);
    }
  }

  private command({
    organizationId,
    connectionId,
    actorUserId,
  }: {
    organizationId: string;
    connectionId: string;
    actorUserId: string;
  }) {
    return {
      tenantId: organizationId,
      organizationId,
      connectionId,
      commandId: newSsoConnectionCommandId(),
      occurredAtMs: this.now(),
      actor: { type: "user" as const, id: actorUserId },
      source: "self-serve" as const,
    };
  }
}
