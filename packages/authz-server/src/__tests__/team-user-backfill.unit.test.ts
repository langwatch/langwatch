import type { CollectedGrants } from "@langwatch/authz";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
  AuthzMigrationRepository,
  ExistingTeamBinding,
  LegacyTeamRow,
  OrganizationScopeInventory,
  TeamBindingWrite,
} from "../authz-migration.repository";
import type { AuthzAuditWriter, AuthzEpochBumper } from "../grants.service";
import { grantFactToCompatBinding } from "../ledger/projection-mapping";
import {
  type BackfillGrantEmission,
  type GrantsLedgerEmitter,
  TeamUserBackfillMigration,
  type TeamUserBackfillDeps,
} from "../team-user-backfill.migration";

const ORG = "org_acme";
const TEAM = "team_support";
const PROJECT = "proj_chatbot";
const SAM = "user_sam";
const CREATED_AT_MS = 1_700_000_000_000;

class FakeMigrationRepository implements AuthzMigrationRepository {
  legacyRows: LegacyTeamRow[] = [];
  bindings: ExistingTeamBinding[] = [];
  inventory: OrganizationScopeInventory = {
    teamIds: [TEAM],
    projects: [{ id: PROJECT, teamId: TEAM }],
  };
  createCalls: TeamBindingWrite[][] = [];

  async findLegacyTeamRows(): Promise<LegacyTeamRow[]> {
    return this.legacyRows;
  }

  async findExistingTeamBindings(): Promise<ExistingTeamBinding[]> {
    return this.bindings;
  }

  async createTeamBindings(rows: TeamBindingWrite[]): Promise<number> {
    this.createCalls.push(rows);
    return rows.length;
  }

  async findOrganizationScopeInventory(): Promise<OrganizationScopeInventory> {
    return this.inventory;
  }
}

/**
 * The ledger as the migration sees it: attach commands land as compat rows
 * through the REAL grantFactToCompatBinding mapping - the same reshaping
 * the projection store performs - so what the tests observe is what the
 * legacy resolver would read after the projection converges.
 */
class FakeLedger implements GrantsLedgerEmitter {
  attachCalls: Array<{
    organizationId: string;
    commandId: string;
    grants: BackfillGrantEmission[];
  }> = [];
  parityCalls: Array<{
    organizationId: string;
    commandId: string;
    diffs: string[];
    occurredAtMs: number;
  }> = [];
  /** Flip off to simulate a projection that never lands its rows. */
  shouldProjectionConverge = true;

  constructor(private readonly repository: FakeMigrationRepository) {}

  async attachGrants(args: {
    organizationId: string;
    commandId: string;
    grants: BackfillGrantEmission[];
  }): Promise<void> {
    this.attachCalls.push(args);
    if (!this.shouldProjectionConverge) return;
    for (const grant of args.grants) {
      const row = grantFactToCompatBinding({
        grant,
        organizationId: args.organizationId,
      });
      if (!row || row.userId === null) continue;
      this.repository.bindings.push({
        userId: row.userId,
        teamId: row.scopeId,
        role: row.role,
        customRoleId: row.customRoleId,
      });
    }
  }

  /** The backfill defines no roles; the genesis import is what uses this. */
  async defineRoles(): Promise<void> {
    throw new Error("the backfill defines no roles");
  }

  /** The backfill revokes nothing; the genesis import's deny-direction
   *  sweep is what uses this. */
  async revokeGrants(): Promise<void> {
    throw new Error("the backfill revokes no grants");
  }

  /** The backfill deletes no roles; the genesis import's deny-direction
   *  sweep is what uses this. */
  async deleteRole(): Promise<void> {
    throw new Error("the backfill deletes no roles");
  }

  async proveMigrationParity(args: {
    organizationId: string;
    commandId: string;
    diffs: string[];
    occurredAtMs: number;
  }): Promise<void> {
    this.parityCalls.push(args);
  }

  /** The cutover's verb; the backfill never flips anything itself. */
  async completeCutover(): Promise<void> {
    throw new Error("the backfill completes no cutover");
  }
}

/** Grants as the real collector would assemble them AFTER the backfill:
 *  bindings mirror the fake repository's rows, legacy rows ride alongside. */
function grantsFor({
  repository,
  userId,
  organizationRole,
  orgAdminBinding,
  legacy,
}: {
  /** Only the promoted rows are read - narrowed so a stale-snapshot case
   *  can hand in a view with fewer bindings, no cast needed. */
  repository: Pick<FakeMigrationRepository, "bindings">;
  userId: string;
  organizationRole: "ADMIN" | "MEMBER";
  orgAdminBinding: boolean;
  legacy: Array<{
    teamId: string;
    role: "ADMIN" | "MEMBER" | "VIEWER" | "CUSTOM";
    customRoleId: string | null;
    isPersonal: boolean;
  }>;
}): CollectedGrants {
  return {
    principal: { type: "user", id: userId },
    organizationId: ORG,
    organizationRole,
    isOrgMember: true,
    bindings: [
      ...(orgAdminBinding
        ? [
            {
              role: "ADMIN" as const,
              customRoleId: null,
              scopeType: "ORGANIZATION" as const,
              scopeId: ORG,
            },
          ]
        : []),
      ...repository.bindings
        .filter((binding) => binding.userId === userId)
        .map((binding) => ({
          role: binding.role,
          customRoleId: binding.customRoleId,
          scopeType: "TEAM" as const,
          scopeId: binding.teamId,
        })),
    ],
    legacyTeamMemberships: legacy,
    customRolePermissions: new Map(),
  };
}

describe("TeamUserBackfillMigration", () => {
  let repository: FakeMigrationRepository;
  let ledger: FakeLedger;
  let audit: AuthzAuditWriter;
  let bumpEpoch: AuthzEpochBumper;

  const migrationWith = (
    collectGrants: TeamUserBackfillDeps["collectGrants"],
  ) =>
    new TeamUserBackfillMigration({
      repository,
      collectGrants,
      ledger,
      audit,
      bumpEpoch,
      now: () => Date.now(),
      poll: { intervalMs: 1, timeoutMs: 50 },
    });

  beforeEach(() => {
    repository = new FakeMigrationRepository();
    ledger = new FakeLedger(repository);
    audit = vi.fn(async () => undefined);
    bumpEpoch = vi.fn(async () => undefined);
  });

  describe("given a user whose membership exists only as a legacy team row", () => {
    beforeEach(() => {
      repository.legacyRows = [
        {
          userId: SAM,
          teamId: TEAM,
          role: "ADMIN",
          customRoleId: "cr_1",
          createdAtMs: CREATED_AT_MS,
        },
      ];
    });

    describe("when the migration processes the organization", () => {
      /** @scenario "A legacy team row gains an equivalent team-scoped binding" */
      it("emits a team-scoped grant the projection lands as an equivalent binding", async () => {
        const migration = migrationWith(async ({ principal }) =>
          grantsFor({
            repository,
            userId: principal.id,
            organizationRole: "ADMIN",
            orgAdminBinding: true,
            legacy: [
              {
                teamId: TEAM,
                role: "ADMIN",
                customRoleId: "cr_1",
                isPersonal: false,
              },
            ],
          }),
        );

        await migration.migrateTenant({ tenantId: ORG });

        expect(ledger.attachCalls).toHaveLength(1);
        expect(ledger.attachCalls[0]).toMatchObject({
          organizationId: ORG,
          commandId: `backfill-b:${ORG}:0`,
        });
        expect(ledger.attachCalls[0]!.grants).toEqual([
          expect.objectContaining({
            principal: { type: "user", id: SAM },
            scope: { type: "TEAM", id: TEAM },
            // The custom role IS the row's identity, so it rides in the
            // roleKey; the compat head lands it as (CUSTOM, cr_1).
            roleKey: "custom:cr_1",
            source: "backfill-b",
            // Business time is the legacy row's own createdAt.
            occurredAtMs: CREATED_AT_MS,
          }),
        ]);
        expect(repository.bindings).toEqual([
          expect.objectContaining({
            userId: SAM,
            teamId: TEAM,
            customRoleId: "cr_1",
          }),
        ]);
        // The ledger is the only writer - the migration never touches the
        // tables directly any more.
        expect(repository.createCalls).toHaveLength(0);
      });

      /** @scenario "The backfill bumps the organization's authorization epoch once" */
      it("bumps the epoch once and records one audit event with counts", async () => {
        const migration = migrationWith(async ({ principal }) =>
          grantsFor({
            repository,
            userId: principal.id,
            organizationRole: "ADMIN",
            orgAdminBinding: true,
            legacy: [
              {
                teamId: TEAM,
                role: "ADMIN",
                customRoleId: "cr_1",
                isPersonal: false,
              },
            ],
          }),
        );

        await migration.migrateTenant({ tenantId: ORG });

        expect(bumpEpoch).toHaveBeenCalledTimes(1);
        expect(bumpEpoch).toHaveBeenCalledWith({ organizationId: ORG });
        expect(audit).toHaveBeenCalledTimes(1);
        expect(audit).toHaveBeenCalledWith(
          expect.objectContaining({
            organizationId: ORG,
            action: "authz.migration.team-user-backfill",
            metadata: expect.objectContaining({
              source: "backfill-b",
              created: 1,
            }),
          }),
        );
      });
    });

    describe("when the migration processes the organization twice", () => {
      /** @scenario "Running the backfill twice creates nothing new" */
      it("emits no second command and no second audit event", async () => {
        const migration = migrationWith(async ({ principal }) =>
          grantsFor({
            repository,
            userId: principal.id,
            organizationRole: "ADMIN",
            orgAdminBinding: true,
            legacy: [
              {
                teamId: TEAM,
                role: "ADMIN",
                customRoleId: "cr_1",
                isPersonal: false,
              },
            ],
          }),
        );

        await migration.migrateTenant({ tenantId: ORG });
        await migration.migrateTenant({ tenantId: ORG });

        expect(ledger.attachCalls).toHaveLength(1);
        expect(repository.bindings).toHaveLength(1);
        expect(audit).toHaveBeenCalledTimes(1);
        expect(bumpEpoch).toHaveBeenCalledTimes(1);
      });
    });

    describe("when a custom-role binding already exists under a different role", () => {
      /** @scenario "A custom role already bound at the team is recognised, whatever its role column says" */
      it("recognises it instead of emitting a grant for a fact that has one", async () => {
        // The custom-role unique index is (userId, customRoleId, scopeType,
        // scopeId) - `role` is not in it. Treating role as part of identity
        // would attach a second grant for the same stored fact.
        repository.bindings = [
          {
            userId: SAM,
            teamId: TEAM,
            role: "MEMBER",
            customRoleId: "cr_1",
          },
        ];
        const migration = migrationWith(async ({ principal }) =>
          grantsFor({
            repository,
            userId: principal.id,
            organizationRole: "ADMIN",
            orgAdminBinding: true,
            legacy: [
              {
                teamId: TEAM,
                role: "ADMIN",
                customRoleId: "cr_1",
                isPersonal: false,
              },
            ],
          }),
        );

        await migration.migrateTenant({ tenantId: ORG });

        expect(ledger.attachCalls).toHaveLength(0);
      });
    });

    describe("when a legacy row is CUSTOM with no custom role", () => {
      it("recognises the row the projection wrote back instead of parking", async () => {
        // `roleKeyForTeamRole` is lossy: CUSTOM and VIEWER both map to
        // `viewer`, so this row projects back as VIEWER. Compared on the raw
        // enum the emitted row is never recognised, and the organization
        // times out into `parked` on this pass and every pass after it.
        repository.legacyRows = [
          {
            userId: SAM,
            teamId: TEAM,
            role: "CUSTOM",
            customRoleId: null,
            createdAtMs: CREATED_AT_MS,
          },
        ];
        const migration = migrationWith(async ({ principal }) =>
          grantsFor({
            repository,
            userId: principal.id,
            organizationRole: "ADMIN",
            orgAdminBinding: true,
            legacy: [
              {
                teamId: TEAM,
                role: "CUSTOM",
                customRoleId: null,
                isPersonal: false,
              },
            ],
          }),
        );

        const result = await migration.migrateTenant({ tenantId: ORG });

        expect(result.status).toBe("finalized");
        expect(ledger.attachCalls).toHaveLength(1);
        // And the retry sees its own work: no second emission.
        await migration.migrateTenant({ tenantId: ORG });
        expect(ledger.attachCalls).toHaveLength(1);
      });
    });

    describe("when the previous attempt appended its events then parked", () => {
      /** @scenario "A migration that died after writing publishes its work on the retry" */
      it("bumps the epoch again so the stranded rows become visible", async () => {
        const migration = migrationWith(async ({ principal }) =>
          grantsFor({
            repository,
            userId: principal.id,
            organizationRole: "ADMIN",
            orgAdminBinding: true,
            legacy: [
              {
                teamId: TEAM,
                role: "ADMIN",
                customRoleId: "cr_1",
                isPersonal: false,
              },
            ],
          }),
        );

        // First pass appends and lands the rows; imagine it died on the bump.
        await migration.migrateTenant({ tenantId: ORG });
        vi.mocked(bumpEpoch).mockClear();

        // The retry finds nothing missing - the projection already landed
        // the rows - so without the parked signal it would return early and
        // the epoch would stay stale forever.
        await migration.migrateTenant({
          tenantId: ORG,
          previous: {
            migrationName: "authz-team-user-backfill",
            tenantId: ORG,
            status: "parked",
            report: { kind: "error", message: "epoch bump failed" },
          },
        });

        expect(ledger.attachCalls).toHaveLength(1);
        expect(bumpEpoch).toHaveBeenCalledTimes(1);
        expect(bumpEpoch).toHaveBeenCalledWith({ organizationId: ORG });
      });
    });

    describe("when the projection never lands the emitted rows", () => {
      it("parks the organization instead of sweeping against missing rows", async () => {
        ledger.shouldProjectionConverge = false;
        const migration = migrationWith(async () => {
          throw new Error("sweep must not run");
        });

        await expect(
          migration.migrateTenant({ tenantId: ORG }),
        ).rejects.toThrow(/did not land/);
        // No audit line for work that never became visible.
        expect(audit).not.toHaveBeenCalled();
        expect(bumpEpoch).not.toHaveBeenCalled();
      });
    });

    describe("when the pass is aborted part-way through the parity sweep", () => {
      /** @scenario "A proof interrupted by shutdown parks the organization" */
      it("throws rather than reporting a clean proof it never finished", async () => {
        // Two members, so the sweep has a second iteration to stop at.
        repository.legacyRows = [
          ...repository.legacyRows,
          {
            userId: "user_robin",
            teamId: TEAM,
            role: "ADMIN",
            customRoleId: "cr_1",
            createdAtMs: CREATED_AT_MS,
          },
        ];
        const controller = new AbortController();
        const migration = migrationWith(async ({ principal }) => {
          controller.abort();
          return grantsFor({
            repository,
            userId: principal.id,
            organizationRole: "ADMIN",
            orgAdminBinding: true,
            legacy: [
              {
                teamId: TEAM,
                role: "ADMIN",
                customRoleId: "cr_1",
                isPersonal: false,
              },
            ],
          });
        });

        // Finalizing here would switch the organization off its legacy path
        // on the strength of a sweep that stopped early. Parking is the only
        // safe answer.
        await expect(
          migration.migrateTenant({
            tenantId: ORG,
            signal: controller.signal,
          }),
        ).rejects.toThrow(/aborted/);
        expect(ledger.parityCalls).toHaveLength(0);
      });
    });
  });

  describe("given a personal workspace team", () => {
    /** @scenario "Personal workspace teams keep their bindings team-scoped" */
    it("backfills a binding scoped to the personal team and nothing broader", async () => {
      repository.legacyRows = [
        {
          userId: SAM,
          teamId: "team_personal",
          role: "ADMIN",
          customRoleId: null,
          createdAtMs: CREATED_AT_MS,
        },
      ];
      repository.inventory = {
        teamIds: ["team_personal"],
        projects: [],
      };
      const migration = migrationWith(async ({ principal }) =>
        grantsFor({
          repository,
          userId: principal.id,
          organizationRole: "ADMIN",
          orgAdminBinding: true,
          legacy: [
            {
              teamId: "team_personal",
              role: "ADMIN",
              customRoleId: null,
              isPersonal: true,
            },
          ],
        }),
      );

      const outcome = await migration.migrateTenant({ tenantId: ORG });

      expect(ledger.attachCalls[0]?.grants).toEqual([
        expect.objectContaining({
          scope: { type: "TEAM", id: "team_personal" },
          roleKey: "admin",
        }),
      ]);
      expect(repository.bindings).toEqual([
        expect.objectContaining({ userId: SAM, teamId: "team_personal" }),
      ]);
      expect(outcome.status).toBe("finalized");
    });
  });

  describe("when every member's decisions agree with and without legacy rows", () => {
    /** @scenario "Legacy membership rows resolve identically before finalization" */
    it("finalizes the organization and records the clean proof as a fact", async () => {
      repository.legacyRows = [
        {
          userId: SAM,
          teamId: TEAM,
          role: "ADMIN",
          customRoleId: null,
          createdAtMs: CREATED_AT_MS,
        },
      ];
      const collectGrants = vi.fn(async ({ principal }) =>
        grantsFor({
          repository,
          userId: principal.id,
          organizationRole: "ADMIN",
          orgAdminBinding: true,
          legacy: [
            { teamId: TEAM, role: "ADMIN", customRoleId: null, isPersonal: false },
          ],
        }),
      );
      const migration = migrationWith(collectGrants);

      const outcome = await migration.migrateTenant({ tenantId: ORG });

      expect(outcome.status).toBe("finalized");
      expect(outcome.report).toMatchObject({
        kind: "parity_clean",
        backfilled: 1,
        usersVerified: 1,
      });
      expect(collectGrants).toHaveBeenCalledWith({
        principal: { type: "user", id: SAM },
        organizationId: ORG,
      });
      expect(ledger.parityCalls).toEqual([
        expect.objectContaining({
          organizationId: ORG,
          commandId: `backfill-b:parity:${ORG}`,
          diffs: [],
        }),
      ]);
    });
  });

  describe("when a legacy row grants an organization-level answer no binding grants", () => {
    /** @scenario "The legacy org-level union keeps working through finalization" */
    it("finalizes anyway - the union's replacement arrives at cutover, not here", async () => {
      repository.legacyRows = [
        {
          userId: SAM,
          teamId: TEAM,
          role: "ADMIN",
          customRoleId: null,
          createdAtMs: CREATED_AT_MS,
        },
      ];
      // No ORGANIZATION-scoped binding: the legacy org-level union is the
      // only source of this user's org-scope answers. The sweep does not
      // cover the organization scope - the rows stay live there until
      // contract, and the genesis-minted floor grant is what replaces the
      // union - so this must NOT hold the organization. It once did, which
      // parked every organization holding an ordinary member and deadlocked
      // the cutover waiting on a finalization that could never come.
      const migration = migrationWith(async ({ principal }) =>
        grantsFor({
          repository,
          userId: principal.id,
          organizationRole: "MEMBER",
          orgAdminBinding: false,
          legacy: [
            { teamId: TEAM, role: "ADMIN", customRoleId: null, isPersonal: false },
          ],
        }),
      );

      const outcome = await migration.migrateTenant({ tenantId: ORG });

      expect(outcome.status).toBe("finalized");
      expect(outcome.report).toMatchObject({ kind: "parity_clean" });
      expect(ledger.parityCalls).toHaveLength(1);
    });

    /** @scenario "A held organization heals itself on a later pass" */
    it("finalizes on a later pass once the promoted binding reaches the snapshot", async () => {
      repository.legacyRows = [
        {
          userId: SAM,
          teamId: TEAM,
          role: "ADMIN",
          customRoleId: null,
          createdAtMs: CREATED_AT_MS,
        },
      ];
      // First pass: the collected snapshot is STALE - it carries the legacy
      // row but not the binding the backfill just promoted it to, so the
      // team-scope decisions genuinely disagree and the organization is
      // held. Second pass: the snapshot caught up, the sweep is clean.
      let snapshotSeesPromotedBindings = false;
      const migration = migrationWith(async ({ principal }) =>
        grantsFor({
          repository: snapshotSeesPromotedBindings
            ? repository
            : { bindings: [] },
          userId: principal.id,
          organizationRole: "MEMBER",
          orgAdminBinding: false,
          legacy: [
            { teamId: TEAM, role: "ADMIN", customRoleId: null, isPersonal: false },
          ],
        }),
      );

      const held = await migration.migrateTenant({ tenantId: ORG });
      expect(held.status).toBe("migrated");
      expect(held.report).toMatchObject({ kind: "parity_diff" });
      const report = held.report as {
        diffs: Array<{ scopeType: string; allowedWithLegacy: boolean }>;
      };
      expect(report.diffs[0]).toMatchObject({
        userId: SAM,
        scopeType: "team",
        allowedWithLegacy: true,
        allowedWithoutLegacy: false,
      });

      snapshotSeesPromotedBindings = true;
      const healed = await migration.migrateTenant({ tenantId: ORG });
      expect(healed.status).toBe("finalized");
    });
  });

  describe("when the organization has no legacy rows at all", () => {
    it("finalizes immediately without emissions, audits, or epoch bumps", async () => {
      const collectGrants = vi.fn();
      const migration = migrationWith(collectGrants);

      const outcome = await migration.migrateTenant({ tenantId: ORG });

      expect(outcome.status).toBe("finalized");
      expect(ledger.attachCalls).toHaveLength(0);
      expect(audit).not.toHaveBeenCalled();
      expect(bumpEpoch).not.toHaveBeenCalled();
      expect(collectGrants).not.toHaveBeenCalled();
      // The trivially clean proof is still recorded - the cutover
      // projection gets its provedAt for empty organizations too.
      expect(ledger.parityCalls).toHaveLength(1);
    });
  });
});
