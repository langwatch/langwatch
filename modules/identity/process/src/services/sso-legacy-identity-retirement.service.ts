import type { LegacySsoAccessQuery } from "@langwatch/auth-contract";
import { HandledError } from "@langwatch/handled-error";
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
import { legacyStandingOf, successorsOf } from "../rules/sso-migration.rules.ts";
import type { IdentityService } from "./identity.service.ts";
import type {
  SsoLegacyAccessReads,
  SsoMigrationMemberships,
} from "./sso-migration-progress.service.ts";

/** A connection nobody can act on any further no longer holds a provider. */
const CLOSED_STATES = new Set(["DISCARDED", "TORN_DOWN"]);

/** Retiring the accounts as well as counting them, both answered by the
 *  module that owns the rows (ADR-129). */
export interface SsoLegacyAccessRetirement extends SsoLegacyAccessReads {
  retire(args: LegacySsoAccessQuery): Promise<{ retired: number; remaining: number }>;
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

  /**
   * Retires every member's identity on the previous provider except where it
   * is their only way in: that one stays, stops working at teardown, and the
   * replacement matches them by address at their next sign-in.
   */
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
    const { legacyIdentifierIds, strandedUserIds } = legacyStandingOf({ holdings, legacy });
    const retiring = holdings
      .filter(
        (holding) =>
          legacyIdentifierIds.has(holding.identifierId) && !strandedUserIds.has(holding.userId),
      )
      .toSorted((left, right) => left.identifierId.localeCompare(right.identifierId));

    for (const holding of retiring) {
      const [successor] = successorsOf({
        holdings: holdings.filter(({ userId }) => userId === holding.userId),
        legacyIdentifierIds,
        replacement,
      });
      await this.retireIdentifier({ request, legacy, holding, successor });
    }

    await this.deps.legacyAccess.retire({
      organizationId: request.organizationId,
      connectionId: legacy.connectionId,
      strandedUserIds: [...strandedUserIds],
    });
  }

  private async retireIdentifier({
    request,
    legacy,
    holding,
    successor,
  }: {
    request: RetirementRequest;
    legacy: SsoConnectionState;
    holding: MigrationIdentifierHolding;
    successor: MigrationIdentifierHolding | undefined;
  }): Promise<void> {
    await this.requireProviderExclusive({
      organizationId: request.organizationId,
      userId: holding.userId,
      providerId: legacy.idpMetadata.providerId,
    });
    if (holding.state === "PRIMARY" && successor?.state === "VERIFIED") {
      await this.deps.identity.markPrimary({
        ...this.command({ userId: holding.userId, actorUserId: request.actorUserId }),
        identifierId: successor.identifierId,
      });
    }
    await this.deps.identity.detachIdentifier({
      ...this.command({ userId: holding.userId, actorUserId: request.actorUserId }),
      identifierId: holding.identifierId,
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
    const connection = await this.deps.connections
      .getConnection({ connectionId })
      .catch((error: unknown) => {
        if (HandledError.isHandled(error) && error.code === "sso_connection_not_found") return null;
        throw error;
      });
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
