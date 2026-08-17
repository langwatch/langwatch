/**
 * ADR-092 stage B, event-sourced (delivery plan PR 1): every legacy TeamUser
 * row gains an equivalent TEAM-scoped grant, emitted through the grants
 * ledger - the projection's compat head is what writes the role-binding
 * rows the legacy resolver reads. Same position as the imperative M1
 * writer; the implementation is the ledger.
 *
 * The flow per organization: compute the missing rows (identity as the
 * database defines it, see `bindingKey`), emit them as batched
 * `attachGrants` commands with deterministic ids (delivery-plan decision
 * 23: `backfill-b:<org>:<chunk>`; grant ids derive from content), then WAIT
 * for the projection to land every expected compat row before proving
 * parity - a proof swept against rows that are not there yet would hold
 * every organization for nothing. A projection that never converges parks
 * the organization; the retry finds the events already appended and only
 * waits again.
 *
 * The sweep is unchanged: collect-once, decide-twice, one CollectedGrants
 * snapshot per member, the pure engine answering every (permission x scope)
 * pair with and without the legacy rows. A clean sweep is recorded as a
 * `migration_parity_proved` fact before the organization finalizes. Honest
 * disagreements (the legacy org-level union quirk) HOLD the organization
 * (`migrated`), behaviour unchanged, diffs in its report - no proof fact is
 * recorded for an unfinished argument.
 *
 * The Redis epoch bump stays exactly as before (decision 19): the ledger
 * cursor is added alongside it, not instead of it.
 *
 * Spec: specs/rbac/in-place-authz-migration.feature.
 */
import {
  ALL_PERMISSIONS,
  AuthzEngine,
  type AuthzScopeRef,
  type CollectedGrants,
  roleKeyForTeamRole,
  type TeamUserRole,
} from "@langwatch/authz";
import type {
  SystemMigration,
  TenantMigrationOutcome,
  TenantMigrationRecord,
} from "@langwatch/system-migrations";
import type {
  AuthzMigrationRepository,
  LegacyTeamRow,
} from "./authz-migration.repository";
import type { AuthzAuditWriter, AuthzEpochBumper } from "./grants.service";
import { deriveGrantId } from "./ledger/grant-identity";
import type {
  GrantFact,
  GrantsLedgerActor,
  RoleFact,
} from "./ledger/grants-ledger.reducer";
import { TEAM_USER_BACKFILL_MIGRATION_NAME } from "./team-user-backfill.name";

/** The audit trail's actor for writes no human performed. */
const SYSTEM_ACTOR = "system:authz-migration";

/** Reports stay bounded however many decisions disagree. */
const MAX_REPORTED_DIFFS = 50;

/** Entries per attachGrants command: one command appends one event batch,
 *  and a five-figure organization should not ride in a single payload. */
const ATTACH_CHUNK = 500;

export type ParityDiff = {
  userId: string;
  permission: string;
  scopeType: AuthzScopeRef["type"];
  scopeId: string;
  allowedWithLegacy: boolean;
  allowedWithoutLegacy: boolean;
};

/** A grant the backfill asks the ledger to attach: the fact plus the
 *  system actor that authored it. */
export type BackfillGrantEmission = GrantFact & { actor: GrantsLedgerActor };

/**
 * The migration's door into the grants ledger. The app binds these to the
 * `authz_grants` pipeline's command senders; the package never sees the
 * framework. Both are queued sends - convergence is observed through the
 * repository, not through the return.
 */
export type GrantsLedgerEmitter = {
  attachGrants: (args: {
    organizationId: string;
    commandId: string;
    grants: BackfillGrantEmission[];
  }) => Promise<void>;
  /**
   * Role definitions for one organization. A `RoleFact` IS the command's
   * role entry (same six fields), so the app maps the batch straight onto
   * the payload. The actor rides at the command level here rather than per
   * entry, because that is where the `role_defined` command carries it.
   */
  defineRoles: (args: {
    organizationId: string;
    commandId: string;
    roles: RoleFact[];
    actor: GrantsLedgerActor;
  }) => Promise<void>;
  proveMigrationParity: (args: {
    organizationId: string;
    commandId: string;
    diffs: string[];
    occurredAtMs: number;
  }) => Promise<void>;
};

export type TeamUserBackfillDeps = {
  repository: AuthzMigrationRepository;
  /** The composed collector's collectGrants, bound in the app runtime. */
  collectGrants: (args: {
    principal: { type: "user"; id: string };
    organizationId: string;
  }) => Promise<CollectedGrants>;
  ledger: GrantsLedgerEmitter;
  audit: AuthzAuditWriter;
  bumpEpoch: AuthzEpochBumper;
  now: () => number;
  /** How long to wait for the projection's compat rows before parking. */
  poll?: { intervalMs: number; timeoutMs: number };
};

const DEFAULT_POLL = { intervalMs: 500, timeoutMs: 120_000 };

export class TeamUserBackfillMigration implements SystemMigration {
  readonly name = TEAM_USER_BACKFILL_MIGRATION_NAME;
  private readonly engine = new AuthzEngine();

  constructor(private readonly deps: TeamUserBackfillDeps) {}

  async migrateTenant({
    tenantId,
    signal,
    previous,
  }: {
    tenantId: string;
    signal?: AbortSignal;
    previous?: TenantMigrationRecord | null;
  }): Promise<TenantMigrationOutcome> {
    const organizationId = tenantId;
    const legacyRows =
      await this.deps.repository.findLegacyTeamRows({ organizationId });

    const backfilled = await this.backfillMissingGrants({
      organizationId,
      legacyRows,
      signal,
      // A parked attempt may have appended its events and died before
      // bumping the epoch. This pass emits nothing new (the projection
      // already landed the rows), so without this the bump that publishes
      // them would never happen and every cache would keep serving
      // pre-backfill decisions.
      shouldRepublishEpoch: previous?.status === "parked",
    });

    // Only members with legacy rows can decide differently without them -
    // for everyone else the two runs are the same pure function of the same
    // input. No rows at all means the organization finalizes on the spot.
    const userIds = [...new Set(legacyRows.map((row) => row.userId))];
    const diffs = await this.sweepParity({ organizationId, userIds, signal });

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
    // The clean proof becomes a ledger fact before the organization flips.
    // Deterministic commandId: a crash between this send and the state
    // write re-runs the tenant, and the retry's identical events dedupe.
    await this.deps.ledger.proveMigrationParity({
      organizationId,
      commandId: `backfill-b:parity:${organizationId}`,
      diffs: [],
      occurredAtMs: this.deps.now(),
    });
    return {
      status: "finalized",
      report: { kind: "parity_clean", backfilled, usersVerified: userIds.length },
    };
  }

  private async backfillMissingGrants({
    organizationId,
    legacyRows,
    signal,
    shouldRepublishEpoch,
  }: {
    organizationId: string;
    legacyRows: LegacyTeamRow[];
    signal?: AbortSignal;
    shouldRepublishEpoch: boolean;
  }): Promise<number> {
    if (legacyRows.length === 0) return 0;

    const existing = await this.deps.repository.findExistingTeamBindings({
      organizationId,
    });
    const existingKeys = new Set(existing.map(bindingKey));
    const missing = legacyRows
      .filter((row) => !existingKeys.has(bindingKey(row)))
      // Deterministic order: a retried pass chunks identically, so its
      // commands carry the same ids and the same idempotency keys.
      .sort((a, b) => bindingKey(a).localeCompare(bindingKey(b)));

    if (missing.length > 0) {
      const emissions = missing.map((row) =>
        legacyRowToEmission({ organizationId, row }),
      );
      for (let i = 0; i < emissions.length; i += ATTACH_CHUNK) {
        await this.deps.ledger.attachGrants({
          organizationId,
          commandId: `backfill-b:${organizationId}:${i / ATTACH_CHUNK}`,
          grants: emissions.slice(i, i + ATTACH_CHUNK),
        });
      }
      await this.awaitCompatRows({ organizationId, missing, signal });
      await this.deps.audit({
        userId: SYSTEM_ACTOR,
        organizationId,
        action: "authz.migration.team-user-backfill",
        metadata: {
          source: "backfill-b",
          created: missing.length,
          legacyRows: legacyRows.length,
        },
      });
    }
    // One bump after the batch has LANDED: every projected row becomes
    // visible to caches and passports together (runbook M7 discipline).
    // Bumping is also how a resumed attempt publishes rows its predecessor
    // appended before dying - cheap, and the alternative is a silently
    // stale fleet.
    if (missing.length > 0 || shouldRepublishEpoch) {
      await this.deps.bumpEpoch({ organizationId });
    }
    return missing.length;
  }

  /**
   * Block until the projection's compat head carries every expected row.
   * The parity sweep reads those rows through the collector, so sweeping
   * before they land would hold every organization on a phantom diff.
   * Timing out throws - the tenant parks and the next pass waits again
   * against events that are already durable.
   */
  private async awaitCompatRows({
    organizationId,
    missing,
    signal,
  }: {
    organizationId: string;
    missing: LegacyTeamRow[];
    signal?: AbortSignal;
  }): Promise<void> {
    const poll = this.deps.poll ?? DEFAULT_POLL;
    const deadline = this.deps.now() + poll.timeoutMs;
    const wanted = new Set(missing.map(bindingKey));
    for (;;) {
      if (signal?.aborted) {
        throw new Error(
          "backfill aborted while waiting for the grants projection; tenant parked for retry",
        );
      }
      const rows = await this.deps.repository.findExistingTeamBindings({
        organizationId,
      });
      const present = new Set(rows.map(bindingKey));
      if ([...wanted].every((key) => present.has(key))) return;
      if (this.deps.now() >= deadline) {
        throw new Error(
          `grants projection did not land ${wanted.size} backfilled row(s) within ${poll.timeoutMs}ms; tenant parked for retry`,
        );
      }
      await new Promise((resolve) => setTimeout(resolve, poll.intervalMs));
    }
  }

  private async sweepParity({
    organizationId,
    userIds,
    signal,
  }: {
    organizationId: string;
    userIds: string[];
    signal?: AbortSignal;
  }): Promise<ParityDiff[]> {
    if (userIds.length === 0) return [];

    const inventory =
      await this.deps.repository.findOrganizationScopeInventory({
        organizationId,
      });
    const diffs: ParityDiff[] = [];

    for (const userId of userIds) {
      // Throw rather than return what we have: an aborted sweep proves
      // nothing, and returning a short diff list reads as "clean" - which
      // would finalize the organization on a proof that never finished.
      // Parking it instead costs one retry on the next boot.
      if (signal?.aborted) {
        throw new Error(
          "parity sweep aborted before completing; tenant parked for retry",
        );
      }
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

/**
 * A legacy row as the ledger will attach it. Business time is the row's own
 * createdAt (it is part of the grant's identity - see grant-identity.ts);
 * roleKey keeps the custom role when one is assigned, since the partial
 * unique indexes make the custom role id the row's identity, not its role
 * column.
 *
 * The row's `role` still travels, as `legacyRole`, precisely because roleKey
 * cannot carry it: the legacy resolver falls back to that column whenever the
 * custom role's permission list is empty, so dropping it would turn an ADMIN
 * with an empty custom role into a viewer. It rides the FACT (and so the
 * event) rather than being read back at fold time, which is what keeps the
 * replay deterministic.
 */
function legacyRowToEmission({
  organizationId,
  row,
}: {
  organizationId: string;
  row: LegacyTeamRow;
}): BackfillGrantEmission {
  const principal = { type: "user" as const, id: row.userId };
  const scope = { type: "TEAM" as const, id: row.teamId };
  return {
    grantId: deriveGrantId({
      organizationId,
      principal,
      scope,
      occurredAtMs: row.createdAtMs,
    }),
    principal,
    roleKey:
      row.customRoleId === null
        ? roleKeyForTeamRole(row.role)
        : `custom:${row.customRoleId}`,
    ...(row.customRoleId === null ? {} : { legacyRole: row.role }),
    scope,
    source: "backfill-b",
    occurredAtMs: row.createdAtMs,
    actor: { type: "system", id: SYSTEM_ACTOR },
  };
}

/**
 * Identity as the DATABASE defines it - which is two keys, not one. The
 * partial unique indexes (migration
 * 20260410120000_fix_role_binding_unique_custom_role) key a built-in binding
 * on its role and a custom one on its custom role id, so a custom binding's
 * `role` column is not part of its identity at all.
 *
 * Keying on both would call an existing custom binding "missing" whenever its
 * role happened to differ, and the emission that followed would attach a
 * grant for a fact that already has one.
 *
 * Built-in rows key on the ROLE KEY, not on the raw enum value, because this
 * function is asked to compare two populations written in different
 * vocabularies: legacy rows straight from `TeamUser`, and the compat rows the
 * projection wrote back. `roleKeyForTeamRole` is lossy — CUSTOM and VIEWER
 * both map to `viewer` — so a `CUSTOM` row with no custom role projects back
 * as `VIEWER`. Keyed on the raw enum those two never match: the row is
 * emitted, its projection is never recognized, and `awaitCompatRows` times
 * the organization out into `parked` on every pass, forever. Normalizing
 * both sides through the same mapping is what makes the comparison honest.
 */
function bindingKey(row: {
  userId: string;
  teamId: string;
  role: TeamUserRole;
  customRoleId: string | null;
}): string {
  return row.customRoleId === null
    ? `${row.userId}::${row.teamId}::builtin::${roleKeyForTeamRole(row.role)}`
    : `${row.userId}::${row.teamId}::custom::${row.customRoleId}`;
}
