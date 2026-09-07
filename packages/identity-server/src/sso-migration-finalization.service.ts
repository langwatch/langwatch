import {
  SsoConnectionCommandRefusedError,
  SsoConnectionInvalidTransitionError,
  type SsoConnectionLifecycleState,
  type SsoMigrationPhase,
} from "@langwatch/identity";
import type { SsoConnectionService } from "./sso-connection.service";

export interface SsoMigrationFinalizationBlocker {
  code: string;
  message: string;
}

/** The facts finalization must re-read before and after every durable step. */
export interface SsoMigrationFinalizationEvidence {
  legacyConnectionId: string;
  legacyState: SsoConnectionLifecycleState;
  phase: SsoMigrationPhase;
  blockers: readonly SsoMigrationFinalizationBlocker[];
  /** No live legacy Identifier and no legacy Account row remain. */
  legacyAccessRetired: boolean;
}

export interface SsoMigrationFinalizationReadPort {
  inspect(args: {
    organizationId: string;
    replacementConnectionId: string;
  }): Promise<SsoMigrationFinalizationEvidence | null>;
}

/**
 * Retires one organization's legacy identities through the identity/account
 * ceremonies. It must be idempotent: the orchestrator deliberately calls it
 * again after an interrupted FINALIZING attempt.
 */
export interface SsoLegacyIdentityRetirementPort {
  retire(args: {
    organizationId: string;
    legacyConnectionId: string;
    replacementConnectionId: string;
    actorUserId: string;
  }): Promise<void>;
}

export class SsoMigrationFinalizationBlockedError extends SsoConnectionCommandRefusedError {
  constructor(blockers: readonly SsoMigrationFinalizationBlocker[]) {
    super(
      "sso_migration_finalization_blocked",
      "sso_migration_finalization_blocked",
      {
        httpStatus: 409,
        fault: "customer",
        meta: { blockerCodes: blockers.map(({ code }) => code) },
        reasons: blockers.map(({ message }) => new Error(message)),
      },
    );
    this.name = "SsoMigrationFinalizationBlockedError";
  }
}

export interface SsoMigrationFinalizationServiceDeps {
  connections: () => SsoConnectionService;
  evidence: SsoMigrationFinalizationReadPort;
  retirement: SsoLegacyIdentityRetirementPort;
  now?: () => number;
  newCommandId: () => string;
}

interface FinalizationRequest {
  organizationId: string;
  replacementConnectionId: string;
  actorUserId: string;
}

/**
 * Conservative Auth0-to-direct finalization.
 *
 * FINALIZING is the durable callback gate and therefore lands before any
 * account is removed. Every later step is repeatable and followed by a fresh
 * evidence read. A process may die after any await: the next call observes
 * FINALIZING or TEARDOWN_PENDING and resumes instead of pretending the work
 * completed.
 */
export class SsoMigrationFinalizationService {
  private readonly now: () => number;

  constructor(private readonly deps: SsoMigrationFinalizationServiceDeps) {
    this.now = deps.now ?? Date.now;
  }

  async finalize({
    organizationId,
    replacementConnectionId,
    actorUserId,
  }: FinalizationRequest): Promise<void> {
    const request = {
      organizationId,
      replacementConnectionId,
      actorUserId,
    };
    const evidence = await this.inspect(request);
    if (evidence.phase === "FINALIZED") return;
    this.requireReady(evidence);
    await this.enterFinalizing(request, evidence);
    await this.retireLegacyIdentities(request);
    await this.completeLegacyTeardown(request);
    await this.deps.connections().finalizeMigration(
      this.command({
        organizationId,
        connectionId: replacementConnectionId,
        actorUserId,
      }),
    );
  }

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

  private async retireLegacyIdentities(
    request: FinalizationRequest,
  ): Promise<void> {
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
          message:
            "Legacy accounts or identifiers remain after the retirement pass.",
        },
      ]);
    }
  }

  private async completeLegacyTeardown(
    request: FinalizationRequest,
  ): Promise<void> {
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
          message:
            "The legacy connection has not completed its retirement ceremony.",
        },
      ]);
    }
  }

  private async inspect({
    organizationId,
    replacementConnectionId,
  }: {
    organizationId: string;
    replacementConnectionId: string;
  }): Promise<SsoMigrationFinalizationEvidence> {
    const evidence = await this.deps.evidence.inspect({
      organizationId,
      replacementConnectionId,
    });
    if (!evidence) {
      throw new SsoConnectionInvalidTransitionError(
        `connection ${replacementConnectionId}: no legacy migration pair exists for organization ${organizationId}`,
      );
    }
    return evidence;
  }

  private requireReady(evidence: SsoMigrationFinalizationEvidence): void {
    if (evidence.blockers.length > 0) {
      throw new SsoMigrationFinalizationBlockedError(evidence.blockers);
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
    if (legacyState !== "TEARDOWN_PENDING") {
      await this.deps.connections().requestTeardown({
        ...this.command({
          organizationId,
          connectionId: legacyConnectionId,
          actorUserId,
        }),
        reason: "direct-sso-migration-finalized",
        graceMs: 0,
      });
    }
    await this.deps.connections().completeTeardown(
      this.command({
        organizationId,
        connectionId: legacyConnectionId,
        actorUserId,
      }),
    );
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
      commandId: this.deps.newCommandId(),
      occurredAtMs: this.now(),
      actor: { type: "user" as const, id: actorUserId },
      source: "self-serve" as const,
    };
  }
}
