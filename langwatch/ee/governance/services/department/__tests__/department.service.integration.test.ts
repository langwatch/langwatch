/**
 * @vitest-environment node
 *
 * Department entity + assignment against a real Postgres test container,
 * no mocks. Binds the entity scenarios of departments.feature.
 */
import { OrganizationUserRole } from "@prisma/client";
import { nanoid } from "nanoid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  DepartmentAssignmentTargetNotFoundError,
  DepartmentService,
} from "../department.service";

import { prisma } from "../../../../../src/server/db";
import {
  startTestContainers,
  stopTestContainers,
} from "../../../../../src/server/event-sourcing/__tests__/integration/testContainers";

describe("DepartmentService", () => {
  const ns = `dept-${nanoid(8)}`;
  const ORG_ID = `org-${ns}`;
  const OTHER_ORG_ID = `org-other-${ns}`;
  const TEAM_ID = `team-${ns}`;
  const PROJECT_ID = `proj-${ns}`;
  const ROBIN = `usr-robin-${ns}`;

  const service = () => DepartmentService.create(prisma);

  beforeAll(async () => {
    await startTestContainers();
    await prisma.organization.createMany({
      data: [
        { id: ORG_ID, name: ns, slug: ORG_ID },
        { id: OTHER_ORG_ID, name: `${ns}-other`, slug: OTHER_ORG_ID },
      ],
    });
    await prisma.user.create({
      data: { id: ROBIN, email: `${ROBIN}@example.com`, name: ROBIN },
    });
    await prisma.organizationUser.create({
      data: {
        organizationId: ORG_ID,
        userId: ROBIN,
        role: OrganizationUserRole.MEMBER,
      },
    });
    await prisma.team.create({
      data: { id: TEAM_ID, name: TEAM_ID, slug: `team-${ns}`, organizationId: ORG_ID },
    });
    await prisma.project.create({
      data: {
        id: PROJECT_ID,
        name: PROJECT_ID,
        slug: `proj-${ns}`,
        teamId: TEAM_ID,
        language: "en",
        framework: "openai",
        apiKey: `key-${ns}`,
      },
    });
  }, 60_000);

  afterAll(async () => {
    await prisma.department.deleteMany({
      where: { organizationId: { in: [ORG_ID, OTHER_ORG_ID] } },
    });
    await prisma.project.deleteMany({ where: { team: { organizationId: ORG_ID } } });
    await prisma.team.deleteMany({ where: { organizationId: ORG_ID } });
    await prisma.organizationUser.deleteMany({ where: { organizationId: ORG_ID } });
    await prisma.user.deleteMany({ where: { email: { contains: ns } } });
    await prisma.organization.deleteMany({
      where: { id: { in: [ORG_ID, OTHER_ORG_ID] } },
    });
    await stopTestContainers();
  });

  describe("given an admin managing departments", () => {
    /** @scenario Admin creates and names a department */
    it("creates a named department scoped to the org and hidden from other orgs", async () => {
      const created = await service().create({
        organizationId: ORG_ID,
        name: "Engineering",
      });
      expect(created.name).toBe("Engineering");
      expect(created.organizationId).toBe(ORG_ID);

      const listed = await service().getAll({ organizationId: ORG_ID });
      expect(listed.map((c) => c.id)).toContain(created.id);

      const otherOrgList = await service().getAll({
        organizationId: OTHER_ORG_ID,
      });
      expect(otherOrgList.map((c) => c.id)).not.toContain(created.id);
    });
  });

  describe("given a person assigned to a department", () => {
    /** @scenario A person is assigned to a single department per org */
    it("carries the assignment and replaces it rather than adding a second", async () => {
      const marketing = await service().create({
        organizationId: ORG_ID,
        name: "Marketing",
      });
      const sales = await service().create({
        organizationId: ORG_ID,
        name: "Sales",
      });

      await service().assignUser({
        organizationId: ORG_ID,
        userId: ROBIN,
        departmentId: marketing.id,
      });
      let membership = await prisma.organizationUser.findUniqueOrThrow({
        where: { userId_organizationId: { userId: ROBIN, organizationId: ORG_ID } },
      });
      expect(membership.departmentId).toBe(marketing.id);

      await service().assignUser({
        organizationId: ORG_ID,
        userId: ROBIN,
        departmentId: sales.id,
      });
      membership = await prisma.organizationUser.findUniqueOrThrow({
        where: { userId_organizationId: { userId: ROBIN, organizationId: ORG_ID } },
      });
      expect(membership.departmentId).toBe(sales.id);
    });
  });

  describe("given teams and projects assigned to a department", () => {
    /** @scenario Teams and projects are assignable to a department */
    it("assigns the same department to a team and a project", async () => {
      const engineering = await service().create({
        organizationId: ORG_ID,
        name: "Engineering-shared",
      });
      await service().assignTeam({
        organizationId: ORG_ID,
        teamId: TEAM_ID,
        departmentId: engineering.id,
      });
      await service().assignProject({
        organizationId: ORG_ID,
        projectId: PROJECT_ID,
        departmentId: engineering.id,
      });

      const team = await prisma.team.findUniqueOrThrow({ where: { id: TEAM_ID } });
      const project = await prisma.project.findUniqueOrThrow({
        where: { id: PROJECT_ID },
      });
      expect(team.departmentId).toBe(engineering.id);
      expect(project.departmentId).toBe(engineering.id);
    });
  });

  describe("given an archived department", () => {
    /** @scenario Archiving a department leaves assignments resolvable as Unassigned */
    it("drops the department from the list while leaving the stored assignment in place", async () => {
      const legacy = await service().create({
        organizationId: ORG_ID,
        name: "Legacy",
      });
      await service().assignUser({
        organizationId: ORG_ID,
        userId: ROBIN,
        departmentId: legacy.id,
      });

      await service().archive({ id: legacy.id, organizationId: ORG_ID });

      const listed = await service().getAll({ organizationId: ORG_ID });
      expect(listed.map((c) => c.id)).not.toContain(legacy.id);

      // The stored assignment survives; the rollup resolves it as
      // Unassigned because the archived department is absent from the active
      // name map.
      const membership = await prisma.organizationUser.findUniqueOrThrow({
        where: { userId_organizationId: { userId: ROBIN, organizationId: ORG_ID } },
      });
      expect(membership.departmentId).toBe(legacy.id);
      const activeIds = listed.map((c) => c.id);
      expect(activeIds).not.toContain(membership.departmentId);
    });
  });

  describe("given an assignment target that does not exist in the org", () => {
    it("throws instead of silently reporting success for a missing user/team/project", async () => {
      const dept = await service().create({
        organizationId: ORG_ID,
        name: `Phantom-${nanoid(4)}`,
      });
      await expect(
        service().assignUser({
          organizationId: ORG_ID,
          userId: `nope-${nanoid(6)}`,
          departmentId: dept.id,
        }),
      ).rejects.toBeInstanceOf(DepartmentAssignmentTargetNotFoundError);
      await expect(
        service().assignTeam({
          organizationId: ORG_ID,
          teamId: `nope-${nanoid(6)}`,
          departmentId: dept.id,
        }),
      ).rejects.toBeInstanceOf(DepartmentAssignmentTargetNotFoundError);
      await expect(
        service().assignProject({
          organizationId: ORG_ID,
          projectId: `nope-${nanoid(6)}`,
          departmentId: dept.id,
        }),
      ).rejects.toBeInstanceOf(DepartmentAssignmentTargetNotFoundError);
    });
  });
});
