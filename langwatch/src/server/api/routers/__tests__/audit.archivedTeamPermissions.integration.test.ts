/**
 * @vitest-environment node
 *
 * AUDIT PROBE — not a shipped test. Executes the real permission resolver
 * against real Postgres to observe that archiving a team revokes nothing.
 *
 * `team.archiveById` (src/server/api/routers/team.ts:498-507) writes only
 * `archivedAt` and cascades to nothing. Every listing surface then hides the
 * team (team.prisma.repository.ts:25/45/61/74, team.service.ts:28), so the
 * operator sees the team as gone. But:
 *
 *   - `resolveTeamPermission` (rbac.ts:1013) loads the team with
 *     `findUnique({ where: { id } })` and no `archivedAt: null`, so
 *     team-scoped checks keep passing.
 *   - the org-level legacy union (rbac.ts:1165) reads
 *     `teamUser.findMany({ where: { userId, team: { organizationId, isPersonal: false } } })`
 *     with no `archivedAt: null`, so membership of an ARCHIVED team keeps
 *     conferring org-wide gateway/audit permissions.
 *   - projects under the archived team keep `archivedAt: null` and stay
 *     listed by project.prisma.repository.ts.
 */
import {
  OrganizationUserRole,
  RoleBindingScopeType,
  TeamUserRole,
} from "@prisma/client";
import { nanoid } from "nanoid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { prisma } from "../../../db";
import {
  hasOrganizationPermission,
  hasTeamPermission,
  hasProjectPermission,
} from "../../rbac";

const ns = nanoid(8);
const ORG_ID = `org-audit-arch-${ns}`;
const TEAM_ID = `team-audit-arch-${ns}`;
const PROJECT_ID = `proj-audit-arch-${ns}`;
const USER_ID = `usr-audit-arch-${ns}`;

const session = {
  user: { id: USER_ID, email: `contractor-${ns}@audit.test`, name: "C" },
  expires: new Date(Date.now() + 3_600_000).toISOString(),
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
} as any;

const ctx = { prisma, session };

describe("given a team whose members hold team-scoped and org-inherited permissions", () => {
  beforeAll(async () => {
    await prisma.organization.create({
      data: { id: ORG_ID, name: `Audit Arch ${ns}`, slug: `audit-arch-${ns}` },
    });
    await prisma.user.create({
      data: { id: USER_ID, email: `contractor-${ns}@audit.test`, name: "C" },
    });
    // Plain org MEMBER — no org-level admin powers of their own.
    await prisma.organizationUser.create({
      data: {
        userId: USER_ID,
        organizationId: ORG_ID,
        role: OrganizationUserRole.MEMBER,
      },
    });
    await prisma.team.create({
      data: {
        id: TEAM_ID,
        name: `Audit Team ${ns}`,
        slug: `audit-team-${ns}`,
        organizationId: ORG_ID,
      },
    });
    // Team ADMIN — the grant an offboarding is supposed to remove.
    await prisma.teamUser.create({
      data: { userId: USER_ID, teamId: TEAM_ID, role: TeamUserRole.ADMIN },
    });
    await prisma.roleBinding.create({
      data: {
        id: `rb-audit-arch-${ns}`,
        organizationId: ORG_ID,
        userId: USER_ID,
        role: TeamUserRole.ADMIN,
        scopeType: RoleBindingScopeType.TEAM,
        scopeId: TEAM_ID,
      },
    });
    await prisma.project.create({
      data: {
        id: PROJECT_ID,
        name: `Audit Project ${ns}`,
        slug: `audit-project-${ns}`,
        teamId: TEAM_ID,
        apiKey: `audit-key-${ns}`,
        language: "python",
        framework: "openai",
      },
    });
  });

  afterAll(async () => {
    await prisma.project.deleteMany({ where: { teamId: TEAM_ID } });
    await prisma.roleBinding.deleteMany({ where: { organizationId: ORG_ID } });
    await prisma.teamUser.deleteMany({ where: { teamId: TEAM_ID } });
    await prisma.team.deleteMany({ where: { id: TEAM_ID } });
    await prisma.organizationUser.deleteMany({
      where: { organizationId: ORG_ID },
    });
    await prisma.organization.deleteMany({ where: { id: ORG_ID } });
    await prisma.user.deleteMany({ where: { id: USER_ID } });
  });

  describe("when the team is archived (the product's delete-a-team action)", () => {
    it("hides the team from every listing but revokes none of its permissions", async () => {
      // Baseline: the grants exist before archiving.
      expect(await hasTeamPermission(ctx, TEAM_ID, "project:manage")).toBe(true);
      expect(await hasProjectPermission(ctx, PROJECT_ID, "project:manage")).toBe(
        true,
      );
      expect(
        await hasOrganizationPermission(ctx, ORG_ID, "gatewayBudgets:manage"),
      ).toBe(true);

      // The exact write team.archiveById performs.
      await prisma.team.update({
        where: { id: TEAM_ID },
        data: { archivedAt: new Date() },
      });

      // Every listing surface now treats the team as gone.
      const listed = await prisma.team.findMany({
        where: { organizationId: ORG_ID, archivedAt: null },
        select: { id: true },
      });
      expect(listed.map((t) => t.id)).not.toContain(TEAM_ID);

      // ...but nothing was revoked.
      expect(
        await hasTeamPermission(ctx, TEAM_ID, "project:manage"),
      ).toBe(true);
      expect(
        await hasProjectPermission(ctx, PROJECT_ID, "project:manage"),
      ).toBe(true);
      expect(
        await hasOrganizationPermission(ctx, ORG_ID, "gatewayBudgets:manage"),
      ).toBe(true);

      // The archived team's project is still live and still listed.
      const liveProjects = await prisma.project.findMany({
        where: { archivedAt: null, team: { organizationId: ORG_ID } },
        select: { id: true },
      });
      expect(liveProjects.map((p) => p.id)).toContain(PROJECT_ID);
    });
  });
});
