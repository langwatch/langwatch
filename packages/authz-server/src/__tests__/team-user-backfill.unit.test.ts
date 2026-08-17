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
import {
  TeamUserBackfillMigration,
  type TeamUserBackfillDeps,
} from "../team-user-backfill.migration";

const ORG = "org_acme";
const TEAM = "team_support";
const PROJECT = "proj_chatbot";
const SAM = "user_sam";

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
    let created = 0;
    for (const row of rows) {
      const exists = this.bindings.some(
        (binding) =>
          binding.userId === row.userId &&
          binding.teamId === row.teamId &&
          binding.role === row.role &&
          binding.customRoleId === row.customRoleId,
      );
      if (exists) continue;
      this.bindings.push({
        userId: row.userId,
        teamId: row.teamId,
        role: row.role,
        customRoleId: row.customRoleId,
      });
      created += 1;
    }
    return created;
  }

  async findOrganizationScopeInventory(): Promise<OrganizationScopeInventory> {
    return this.inventory;
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
  repository: FakeMigrationRepository;
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
  let audit: AuthzAuditWriter;
  let bumpEpoch: AuthzEpochBumper;
  let ids: number;

  const migrationWith = (collectGrants: TeamUserBackfillDeps["collectGrants"]) =>
    new TeamUserBackfillMigration({
      repository,
      collectGrants,
      audit,
      bumpEpoch,
      newBindingId: () => `rb_${(ids += 1)}`,
    });

  beforeEach(() => {
    repository = new FakeMigrationRepository();
    audit = vi.fn(async () => undefined);
    bumpEpoch = vi.fn(async () => undefined);
    ids = 0;
  });

  describe("given a user whose membership exists only as a legacy team row", () => {
    beforeEach(() => {
      repository.legacyRows = [
        { userId: SAM, teamId: TEAM, role: "ADMIN", customRoleId: "cr_1" },
      ];
    });

    describe("when the migration processes the organization", () => {
      /** @scenario "A legacy team row gains an equivalent team-scoped binding" */
      it("creates a team-scoped binding carrying the same role and custom role", async () => {
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

        expect(repository.createCalls).toHaveLength(1);
        expect(repository.createCalls[0]).toEqual([
          expect.objectContaining({
            organizationId: ORG,
            userId: SAM,
            teamId: TEAM,
            role: "ADMIN",
            customRoleId: "cr_1",
          }),
        ]);
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
      it("creates no additional bindings and emits no second audit event", async () => {
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

        expect(repository.createCalls).toHaveLength(1);
        expect(repository.bindings).toHaveLength(1);
        expect(audit).toHaveBeenCalledTimes(1);
        expect(bumpEpoch).toHaveBeenCalledTimes(1);
      });
    });

    describe("when the previous attempt committed its bindings then parked", () => {
      /** @scenario "A migration that died after writing publishes its work on the retry" */
      it("bumps the epoch again so the stranded writes become visible", async () => {
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

        // First pass writes the bindings; imagine it died on the bump.
        await migration.migrateTenant({ tenantId: ORG });
        vi.mocked(bumpEpoch).mockClear();

        // The retry finds nothing missing - `createMany` skipped the
        // duplicates - so without the parked signal it would return early
        // and the epoch would stay stale forever.
        await migration.migrateTenant({
          tenantId: ORG,
          previous: {
            migrationName: "authz-team-user-backfill",
            tenantId: ORG,
            status: "parked",
            report: { kind: "error", message: "epoch bump failed" },
          },
        });

        expect(repository.createCalls).toHaveLength(1);
        expect(bumpEpoch).toHaveBeenCalledTimes(1);
        expect(bumpEpoch).toHaveBeenCalledWith({ organizationId: ORG });
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
      });
    });
  });

  describe("given a personal workspace team", () => {
    /** @scenario "Personal workspace teams keep their bindings team-scoped" */
    it("backfills a binding scoped to the personal team and nothing broader", async () => {
      repository.legacyRows = [
        { userId: SAM, teamId: "team_personal", role: "ADMIN", customRoleId: null },
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

      expect(repository.bindings).toEqual([
        expect.objectContaining({ userId: SAM, teamId: "team_personal" }),
      ]);
      expect(outcome.status).toBe("finalized");
    });
  });

  describe("when every member's decisions agree with and without legacy rows", () => {
    /** @scenario "Legacy membership rows resolve identically before finalization" */
    it("finalizes the organization with the sweep's evidence", async () => {
      repository.legacyRows = [
        { userId: SAM, teamId: TEAM, role: "ADMIN", customRoleId: null },
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
    });
  });

  describe("when a legacy row grants an organization-level answer no binding grants", () => {
    /** @scenario "An organization relying on the legacy org-level union is held, not broken" */
    it("holds the organization as migrated with the disagreements in its report", async () => {
      repository.legacyRows = [
        { userId: SAM, teamId: TEAM, role: "ADMIN", customRoleId: null },
      ];
      // No ORGANIZATION-scoped binding: the legacy org-level union is the
      // only source of this user's org-scope answers.
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

      expect(outcome.status).toBe("migrated");
      expect(outcome.report).toMatchObject({ kind: "parity_diff" });
      const report = outcome.report as {
        totalDiffs: number;
        diffs: Array<{
          userId: string;
          scopeType: string;
          allowedWithLegacy: boolean;
          allowedWithoutLegacy: boolean;
        }>;
      };
      expect(report.totalDiffs).toBeGreaterThan(0);
      expect(report.diffs[0]).toMatchObject({
        userId: SAM,
        scopeType: "organization",
        allowedWithLegacy: true,
        allowedWithoutLegacy: false,
      });
    });

    /** @scenario "A held organization heals itself once the gap is granted" */
    it("finalizes on a later pass once an organization-scoped binding closes the gap", async () => {
      repository.legacyRows = [
        { userId: SAM, teamId: TEAM, role: "ADMIN", customRoleId: null },
      ];
      let orgAdminBinding = false;
      const migration = migrationWith(async ({ principal }) =>
        grantsFor({
          repository,
          userId: principal.id,
          organizationRole: orgAdminBinding ? "ADMIN" : "MEMBER",
          orgAdminBinding,
          legacy: [
            { teamId: TEAM, role: "ADMIN", customRoleId: null, isPersonal: false },
          ],
        }),
      );

      const held = await migration.migrateTenant({ tenantId: ORG });
      expect(held.status).toBe("migrated");

      orgAdminBinding = true;
      const healed = await migration.migrateTenant({ tenantId: ORG });
      expect(healed.status).toBe("finalized");
    });
  });

  describe("when the organization has no legacy rows at all", () => {
    it("finalizes immediately without writes, audits, or epoch bumps", async () => {
      const collectGrants = vi.fn();
      const migration = migrationWith(collectGrants);

      const outcome = await migration.migrateTenant({ tenantId: ORG });

      expect(outcome.status).toBe("finalized");
      expect(repository.createCalls).toHaveLength(0);
      expect(audit).not.toHaveBeenCalled();
      expect(bumpEpoch).not.toHaveBeenCalled();
      expect(collectGrants).not.toHaveBeenCalled();
    });
  });
});
