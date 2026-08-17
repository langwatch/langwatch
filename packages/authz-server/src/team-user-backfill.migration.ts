/**
 * ADR-092 stage B, in place (runbook M1): every legacy TeamUser row gains
 * an equivalent TEAM-scoped role binding, and an organization is finalized
 * - its legacy fallback switched off - only when a decision-level parity
 * sweep proves the legacy rows no longer change any answer.
 *
 * The sweep is collect-once, decide-twice: one CollectedGrants snapshot per
 * member, then the pure engine answers every (permission x scope) pair with
 * the legacy rows present and with them removed. The two runs agreeing on
 * every decision IS the finalization proof. They can disagree honestly -
 * the legacy org-level union quirk grants org-scope permissions a
 * TEAM-scoped binding never will - and such an organization is HELD
 * (`migrated`), behaviour unchanged, with the disagreements in its report.
 * Granting the gap through a real binding heals it on a later pass.
 *
 * Spec: specs/rbac/in-place-authz-migration.feature.
 */
import {
  ALL_PERMISSIONS,
  AuthzEngine,
  type AuthzScopeRef,
  type CollectedGrants,
} from "@langwatch/authz";
import type {
  SystemMigration,
  TenantMigrationOutcome,
} from "@langwatch/system-migrations";
import type {
  AuthzMigrationRepository,
  LegacyTeamRow,
  TeamBindingWrite,
} from "./authz-migration.repository";
import type { AuthzAuditWriter, AuthzEpochBumper } from "./grants.service";

export const TEAM_USER_BACKFILL_MIGRATION_NAME = "authz-team-user-backfill";

/** The audit trail's actor for writes no human performed. */
const SYSTEM_ACTOR = "system:authz-migration";

/** Reports stay bounded however many decisions disagree. */
const MAX_REPORTED_DIFFS = 50;

export type ParityDiff = {
  userId: string;
  permission: string;
  scopeType: AuthzScopeRef["type"];
  scopeId: string;
  allowedWithLegacy: boolean;
  allowedWithoutLegacy: boolean;
};

export type TeamUserBackfillDeps = {
  repository: AuthzMigrationRepository;
  /** The composed collector's collectGrants, bound in the app runtime. */
  collectGrants: (args: {
    principal: { type: "user"; id: string };
    organizationId: string;
  }) => Promise<CollectedGrants>;
  audit: AuthzAuditWriter;
  bumpEpoch: AuthzEpochBumper;
  newBindingId: () => string;
};

export class TeamUserBackfillMigration implements SystemMigration {
  readonly name = TEAM_USER_BACKFILL_MIGRATION_NAME;
  private readonly engine = new AuthzEngine();

  constructor(private readonly deps: TeamUserBackfillDeps) {}

  async migrateTenant({
    tenantId,
  }: {
    tenantId: string;
  }): Promise<TenantMigrationOutcome> {
    const organizationId = tenantId;
    const legacyRows =
      await this.deps.repository.findLegacyTeamRows({ organizationId });

    const backfilled = await this.backfillMissingBindings({
      organizationId,
      legacyRows,
    });

    // Only members with legacy rows can decide differently without them -
    // for everyone else the two runs are the same pure function of the same
    // input. No rows at all means the organization finalizes on the spot.
    const userIds = [...new Set(legacyRows.map((row) => row.userId))];
    const diffs = await this.sweepParity({ organizationId, userIds });

    if (diffs.length > 0) {
      return {
        status: "migrated",
        report: {
          kind: "parity_diff",
          backfilled,
          usersVerified: userIds.length,
          totalDiffs: diffs.length,
          diffs: diffs.slice(0, MAX_REPORTED_DIFFS),
        },
      };
    }
    return {
      status: "finalized",
      report: { kind: "parity_clean", backfilled, usersVerified: userIds.length },
    };
  }

  private async backfillMissingBindings({
    organizationId,
    legacyRows,
  }: {
    organizationId: string;
    legacyRows: LegacyTeamRow[];
  }): Promise<number> {
    if (legacyRows.length === 0) return 0;

    const existing = await this.deps.repository.findExistingTeamBindings({
      organizationId,
    });
    const existingKeys = new Set(existing.map(bindingKey));
    const missing = legacyRows.filter(
      (row) => !existingKeys.has(bindingKey(row)),
    );
    if (missing.length === 0) return 0;

    const writes: TeamBindingWrite[] = missing.map((row) => ({
      bindingId: this.deps.newBindingId(),
      organizationId,
      userId: row.userId,
      teamId: row.teamId,
      role: row.role,
      customRoleId: row.customRoleId,
    }));
    const created = await this.deps.repository.createTeamBindings(writes);
    if (created === 0) return 0;

    await this.deps.audit({
      userId: SYSTEM_ACTOR,
      organizationId,
      action: "authz.migration.team-user-backfill",
      metadata: { source: "backfill-b", created, legacyRows: legacyRows.length },
    });
    // One bump after the batch: every write above becomes visible to caches
    // and passports together (runbook M7 discipline).
    await this.deps.bumpEpoch({ organizationId });
    return created;
  }

  private async sweepParity({
    organizationId,
    userIds,
  }: {
    organizationId: string;
    userIds: string[];
  }): Promise<ParityDiff[]> {
    if (userIds.length === 0) return [];

    const inventory =
      await this.deps.repository.findOrganizationScopeInventory({
        organizationId,
      });
    const diffs: ParityDiff[] = [];

    for (const userId of userIds) {
      const grants = await this.deps.collectGrants({
        principal: { type: "user", id: userId },
        organizationId,
      });
      if (grants.legacyTeamMemberships.length === 0) continue;
      const withoutLegacy: CollectedGrants = {
        ...grants,
        legacyTeamMemberships: [],
      };

      // Legacy rows can only influence scopes whose chain contains their
      // team - the team itself, its projects, and the organization (through
      // the org-level union step). Sweep exactly those.
      const legacyTeamIds = new Set(
        grants.legacyTeamMemberships.map((row) => row.teamId),
      );
      const scopes: AuthzScopeRef[] = [
        { type: "organization", id: organizationId },
        ...inventory.teamIds
          .filter((teamId) => legacyTeamIds.has(teamId))
          .map(
            (teamId): AuthzScopeRef => ({
              type: "team",
              id: teamId,
              organizationId,
            }),
          ),
        ...inventory.projects
          .filter((project) => legacyTeamIds.has(project.teamId))
          .map(
            (project): AuthzScopeRef => ({
              type: "project",
              id: project.id,
              teamId: project.teamId,
              organizationId,
            }),
          ),
      ];

      for (const scope of scopes) {
        for (const permission of ALL_PERMISSIONS) {
          const withLegacy = this.engine.decide({
            grants,
            permission,
            scope,
          }).allowed;
          const sansLegacy = this.engine.decide({
            grants: withoutLegacy,
            permission,
            scope,
          }).allowed;
          if (withLegacy !== sansLegacy) {
            diffs.push({
              userId,
              permission,
              scopeType: scope.type,
              scopeId: scope.id,
              allowedWithLegacy: withLegacy,
              allowedWithoutLegacy: sansLegacy,
            });
          }
        }
      }
    }
    return diffs;
  }
}

function bindingKey(row: {
  userId: string;
  teamId: string;
  role: string;
  customRoleId: string | null;
}): string {
  return `${row.userId}::${row.teamId}::${row.role}::${row.customRoleId ?? ""}`;
}
