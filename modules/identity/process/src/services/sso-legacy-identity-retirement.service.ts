import {
  SsoMigrationFinalizationBlockedError,
  type SsoConnectionState,
} from "@langwatch/identity-contract";
import { nowInstant } from "@langwatch/time";

import type { SsoConnectionReadRepository } from "../repositories/sso-connection.repository.ts";
import type {
  MigrationIdentifierHolding,
  SsoMigrationEvidenceRepository,
} from "../repositories/sso-migration-evidence.repository.ts";
import { newIdentityCommandId } from "../rules/identity-command-id.rules.ts";
import { identifierBelongsToMigrationConnection } from "../rules/sso-migration.rules.ts";
import type { IdentityService } from "./identity.service.ts";
import type {
  SsoLegacyAccessReads,
  SsoMigrationMemberships,
} from "./sso-migration-progress.service.ts";

/** A connection nobody can act on any further no longer holds a provider. */
const CLOSED_STATES = new Set(["DISCARDED", "TORN_DOWN"]);

/** The two states an identifier counts as a way in from. */
const PROVED_STATES = new Set(["VERIFIED", "PRIMARY"]);

/** Retiring the accounts as well as counting them, both answered by the
 *  module that owns the rows (ADR-129). */
export interface SsoLegacyAccessRetirement extends SsoLegacyAccessReads {
  retire(args: {
    userIds: string[];
    providerId: string;
  }): Promise<{ retired: number; remaining: number }>;
}

/** Membership, plus the one cross-organization question retirement asks:
 *  whether this person's legacy provider is somebody else's too. */
export interface SsoRetirementMemberships extends SsoMigrationMemberships {
  organizationIdsForMember(args: { userId: string }): Promise<string[]>;
}

export interface SsoLegacyIdentityRetirementServiceDeps {
  identity: IdentityService;
  connections: SsoConnectionReadRepository;
  evidence: SsoMigrationEvidenceRepository;
  memberships: SsoRetirementMemberships;
  legacyAccess: SsoLegacyAccessRetirement;
  now?: () => number;
}

interface RetirementRequest {
  organizationId: string;
  legacyConnectionId: string;
  replacementConnectionId: string;
  actorUserId: string;
}

/**
 * Takes one organization's legacy identities out of service through the
 * ordinary ceremonies. Idempotent: an identifier already detached is no
 * longer among the live holdings this walks.
 */
export class SsoLegacyIdentityRetirementService {
  static create(deps: SsoLegacyIdentityRetirementServiceDeps): SsoLegacyIdentityRetirementService {
    return new SsoLegacyIdentityRetirementService(deps);
  }

  private readonly now: () => number;

  private constructor(private readonly deps: SsoLegacyIdentityRetirementServiceDeps) {
    this.now = deps.now ?? (() => nowInstant().epochMilliseconds);
  }

  async retire(request: RetirementRequest): Promise<void> {
    const legacy = await this.requireLegacyConnection(request);
    const replacement = await this.requireConnection({
      organizationId: request.organizationId,
      connectionId: request.replacementConnectionId,
    });
    const members = await this.deps.memberships.listActiveMembers({
      organizationId: request.organizationId,
    });
    const userIds = members.map((member) => member.userId);
    const holdings = await this.deps.evidence.findLiveIdentifierHoldings({ userIds });
    const retiring = holdings
      .filter((holding) =>
        identifierBelongsToMigrationConnection({ identifier: holding, connection: legacy }),
      )
      .toSorted((left, right) => left.identifierId.localeCompare(right.identifierId));

    for (const holding of retiring) {
      await this.retireIdentifier({ request, legacy, replacement, holdings, holding });
    }

    await this.deps.legacyAccess.retire({
      userIds,
      providerId: legacy.idpMetadata.providerId,
    });
  }

  private async retireIdentifier({
    request,
    legacy,
    replacement,
    holdings,
    holding,
  }: {
    request: RetirementRequest;
    legacy: SsoConnectionState;
    replacement: SsoConnectionState;
    holdings: MigrationIdentifierHolding[];
    holding: MigrationIdentifierHolding;
  }): Promise<void> {
    await this.requireProviderExclusive({
      organizationId: request.organizationId,
      userId: holding.userId,
      providerId: legacy.idpMetadata.providerId,
    });
    await this.requireReplacementIsWayIn({
      userId: holding.userId,
      replacement,
      holdings,
      legacyIsPrimary: holding.state === "PRIMARY",
      actorUserId: request.actorUserId,
    });
    await this.deps.identity.detachIdentifier({
      ...this.command({ userId: holding.userId, actorUserId: request.actorUserId }),
      identifierId: holding.identifierId,
    });
  }

  /**
   * The person must still have a way in through the replacement, and it takes
   * over as primary when the legacy identifier was theirs.
   */
  private async requireReplacementIsWayIn({
    userId,
    replacement,
    holdings,
    legacyIsPrimary,
    actorUserId,
  }: {
    userId: string;
    replacement: SsoConnectionState;
    holdings: MigrationIdentifierHolding[];
    legacyIsPrimary: boolean;
    actorUserId: string;
  }): Promise<void> {
    const proved = holdings
      .filter(
        (holding) =>
          holding.userId === userId &&
          PROVED_STATES.has(holding.state) &&
          identifierBelongsToMigrationConnection({ identifier: holding, connection: replacement }),
      )
      .toSorted(
        (left, right) =>
          (right.verifiedAtMs ?? 0) - (left.verifiedAtMs ?? 0) ||
          left.identifierId.localeCompare(right.identifierId),
      );
    const [wayIn] = proved;
    if (!wayIn) {
      throw blocked(
        "members-not-verified-on-replacement",
        `User ${userId} has no verified replacement identifier.`,
      );
    }
    if (!legacyIsPrimary || wayIn.state === "PRIMARY") return;

    await this.deps.identity.markPrimary({
      ...this.command({ userId, actorUserId }),
      identifierId: wayIn.identifierId,
    });
  }

  /** A provider still deciding sign-ins for another organization this person
   *  belongs to is not one this cutover may retire out from under them. */
  private async requireProviderExclusive({
    organizationId,
    userId,
    providerId,
  }: {
    organizationId: string;
    userId: string;
    providerId: string;
  }): Promise<void> {
    const elsewhere = (await this.deps.memberships.organizationIdsForMember({ userId })).filter(
      (held) => held !== organizationId,
    );

    for (const other of elsewhere) {
      const connections = await this.deps.connections.findForOrganization({
        organizationId: other,
      });
      const shared = connections.some(
        (connection) =>
          connection.source === "legacy-grandfathered" &&
          !CLOSED_STATES.has(connection.state) &&
          connection.idpMetadata.providerId === providerId,
      );
      if (shared) {
        throw blocked(
          "legacy-provider-ambiguous",
          `User ${userId}'s legacy provider is also active in another organization.`,
        );
      }
    }
  }

  private async requireLegacyConnection({
    organizationId,
    legacyConnectionId,
  }: RetirementRequest): Promise<SsoConnectionState> {
    const legacy = await this.requireConnection({
      organizationId,
      connectionId: legacyConnectionId,
    });
    if (legacy.source !== "legacy-grandfathered" || !legacy.idpMetadata.providerId) {
      throw blocked(
        "legacy-provider-ambiguous",
        "The legacy connection no longer has an unambiguous provider.",
      );
    }

    return legacy;
  }

  private async requireConnection({
    organizationId,
    connectionId,
  }: {
    organizationId: string;
    connectionId: string;
  }): Promise<SsoConnectionState> {
    const connection = await this.deps.connections.tryFindConnection({ connectionId });
    if (!connection || connection.organizationId !== organizationId) {
      throw blocked(
        "legacy-pair-incomplete",
        `Connection ${connectionId} is not one of this organization's.`,
      );
    }

    return connection;
  }

  private command({ userId, actorUserId }: { userId: string; actorUserId: string }) {
    return {
      tenantId: userId,
      userId,
      commandId: newIdentityCommandId(),
      occurredAtMs: this.now(),
      actor: { type: "user" as const, id: actorUserId },
    };
  }
}

function blocked(code: string, message: string): SsoMigrationFinalizationBlockedError {
  return new SsoMigrationFinalizationBlockedError([{ code, message }]);
}
