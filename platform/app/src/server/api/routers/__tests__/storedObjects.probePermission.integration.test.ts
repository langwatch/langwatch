/**
 * @vitest-environment node
 *
 * Who may probe a stored object. The renderer asks this procedure why a media
 * element failed, so the gate has to match the one the bytes themselves are
 * served behind (`app/api/files/[[...route]]/app.ts` accepts traces:view OR
 * scenarios:view). When it was narrower, a viewer who could fetch a recording
 * could not find out why its player failed, and the player never left its
 * loading state.
 *
 * Real Postgres, real router, no mocks: each caller's only grant is an
 * explicit CUSTOM role binding, so a pass can only come from that grant.
 *
 * Spec: specs/traces-v2/media-rendering.feature
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
  startTestContainers,
  stopTestContainers,
} from "../../../event-sourcing/__tests__/integration/testContainers";
import type { Permission } from "../../rbac";
import { appRouter } from "../../root";
import { createInnerTRPCContext } from "../../trpc";

type Caller = ReturnType<typeof appRouter.createCaller>;

describe("storedObjects.headById — who may probe", () => {
  const ns = `soprobe-${nanoid(8)}`;
  const ORG = `org-${ns}`;
  const TEAM = `team-${ns}`;
  const PROJECT = `proj-${ns}`;
  let seq = 0;

  async function seedCaller(permissions: Permission[]): Promise<Caller> {
    const uid = `usr-${ns}-${seq++}`;
    const email = `${uid}@example.com`;
    await prisma.user.create({ data: { id: uid, email, name: uid } });
    await prisma.organizationUser.create({
      data: {
        organizationId: ORG,
        userId: uid,
        role: OrganizationUserRole.MEMBER,
      },
    });
    const roleId = `crole-${uid}`;
    await prisma.customRole.create({
      data: {
        id: roleId,
        organizationId: ORG,
        name: roleId,
        permissions,
      },
    });
    await prisma.roleBinding.create({
      data: {
        organizationId: ORG,
        userId: uid,
        role: TeamUserRole.CUSTOM,
        customRoleId: roleId,
        scopeType: RoleBindingScopeType.PROJECT,
        scopeId: PROJECT,
      },
    });
    return appRouter.createCaller(
      createInnerTRPCContext({
        session: {
          user: { id: uid, email, name: uid },
          expires: new Date(Date.now() + 3_600_000).toISOString(),
        } as any,
      }),
    );
  }

  beforeAll(async () => {
    await startTestContainers();
    await prisma.organization.create({
      data: { id: ORG, name: ORG, slug: ORG },
    });
    await prisma.team.create({
      data: { id: TEAM, name: TEAM, slug: TEAM, organizationId: ORG },
    });
    await prisma.project.create({
      data: {
        id: PROJECT,
        name: PROJECT,
        slug: PROJECT,
        teamId: TEAM,
        language: "en",
        framework: "openai",
        apiKey: `key-${PROJECT}`,
      },
    });
  }, 60_000);

  afterAll(async () => {
    await prisma.roleBinding.deleteMany({ where: { organizationId: ORG } });
    await prisma.customRole.deleteMany({ where: { organizationId: ORG } });
    await prisma.project.deleteMany({ where: { teamId: TEAM } });
    await prisma.team.deleteMany({ where: { organizationId: ORG } });
    await prisma.organizationUser.deleteMany({
      where: { organizationId: ORG },
    });
    await prisma.organization.deleteMany({ where: { id: ORG } });
    await prisma.user.deleteMany({ where: { email: { contains: ns } } });
    await stopTestContainers();
  });

  describe("given a viewer whose only grant is trace access", () => {
    /** @scenario "A viewer with trace access can probe trace media" */
    it("answers the probe for a viewer holding traces:view", async () => {
      const caller = await seedCaller(["traces:view"]);

      const result = await caller.storedObjects.headById({
        projectId: PROJECT,
        id: `absent-${nanoid(6)}`,
      });

      // No row for this id, which is the honest answer — the point is that the
      // caller reached the service at all instead of being refused.
      expect(result).toEqual({ status: "not_found" });
    });
  });

  describe("given a viewer whose only grant is scenario access", () => {
    /** @scenario "A viewer with trace access can probe trace media" */
    it("still answers the probe for a viewer holding scenarios:view", async () => {
      const caller = await seedCaller(["scenarios:view"]);

      const result = await caller.storedObjects.headById({
        projectId: PROJECT,
        id: `absent-${nanoid(6)}`,
      });

      expect(result).toEqual({ status: "not_found" });
    });
  });

  describe("given a viewer holding neither trace nor scenario access", () => {
    /** @scenario "A viewer with trace access can probe trace media" */
    it("refuses the probe, naming the permission to ask for", async () => {
      const caller = await seedCaller(["datasets:view"]);

      await expect(
        caller.storedObjects.headById({
          projectId: PROJECT,
          id: `absent-${nanoid(6)}`,
        }),
      ).rejects.toMatchObject({
        cause: {
          code: "project_permission_denied",
          meta: { permission: "traces:view" },
        },
      });
    });
  });
});
