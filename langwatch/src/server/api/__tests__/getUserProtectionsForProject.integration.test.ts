/**
 * @vitest-environment node
 *
 * Integration test for the audience-aware read-time visibility wiring in
 * getUserProtectionsForProject against the real database: a restrict rule hides
 * input from a plain member, keeps it visible to an admin, names the audience in
 * the redaction reason, and applies retroactively (changing the rule changes
 * what an existing reader sees, with no re-ingestion).
 */
import type { Project } from "@prisma/client";
import {
  OrganizationUserRole,
  RoleBindingScopeType,
  TeamUserRole,
} from "@prisma/client";
import { nanoid } from "nanoid";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import type { Session } from "~/server/auth";
import { getTestProject } from "../../../utils/testUtils";
import { prisma } from "../../db";
import { getDataPrivacyPolicyService } from "../../data-privacy/dataPrivacyPolicy.service";
import { getUserProtectionsForProject } from "../utils";

const NAMESPACE = "dataprivacy-visibility";

function sessionFor(userId: string): Session {
  return { user: { id: userId } } as unknown as Session;
}

describe("getUserProtectionsForProject audience-aware visibility", () => {
  const service = getDataPrivacyPolicyService();
  let project: Project;
  let organizationId: string;
  let adminUserId: string;
  let memberUserId: string;

  beforeAll(async () => {
    project = await getTestProject(NAMESPACE);
    const team = await prisma.team.findUniqueOrThrow({
      where: { id: project.teamId },
      select: { organizationId: true },
    });
    organizationId = team.organizationId;

    const admin = await prisma.user.create({
      data: { name: "Carol Admin", email: `carol-${nanoid()}@example.com` },
    });
    const member = await prisma.user.create({
      data: { name: "Dave Member", email: `dave-${nanoid()}@example.com` },
    });
    adminUserId = admin.id;
    memberUserId = member.id;
    await prisma.organizationUser.createMany({
      data: [
        { userId: adminUserId, organizationId, role: OrganizationUserRole.ADMIN },
        { userId: memberUserId, organizationId, role: OrganizationUserRole.MEMBER },
      ],
    });
    // Team RoleBindings make membership resolve from the binding query directly,
    // so the read path never needs the (uninitialized) app layer in tests.
    await prisma.roleBinding.createMany({
      data: [
        {
          organizationId,
          userId: adminUserId,
          role: TeamUserRole.ADMIN,
          scopeType: RoleBindingScopeType.TEAM,
          scopeId: project.teamId,
        },
        {
          organizationId,
          userId: memberUserId,
          role: TeamUserRole.MEMBER,
          scopeType: RoleBindingScopeType.TEAM,
          scopeId: project.teamId,
        },
      ],
    });
  });

  beforeEach(async () => {
    await prisma.dataPrivacyPolicy.deleteMany({ where: { organizationId } });
  });

  afterAll(async () => {
    await prisma.dataPrivacyPolicy.deleteMany({ where: { organizationId } });
    await prisma.roleBinding.deleteMany({
      where: { userId: { in: [adminUserId, memberUserId] }, organizationId },
    });
    await prisma.organizationUser.deleteMany({
      where: { userId: { in: [adminUserId, memberUserId] }, organizationId },
    });
    await prisma.user.deleteMany({
      where: { id: { in: [adminUserId, memberUserId] } },
    });
  });

  async function protections(userId: string) {
    return getUserProtectionsForProject(
      { prisma, session: sessionFor(userId), publiclyShared: false },
      { projectId: project.id },
    );
  }

  describe("when no privacy rule exists", () => {
    /** @scenario Restriction is retroactive */
    it("shows input to a member, then hides it once a restrict rule is added", async () => {
      const before = await protections(memberUserId);
      expect(before.canSeeCapturedInput).toBe(true);

      await service.setForScope({
        scope: { scopeType: "PROJECT", scopeId: project.id },
        personalOnly: false,
        config: {
          categories: { input: { disposition: "restrict", audience: { admins: true } } },
        },
      });

      const after = await protections(memberUserId);
      expect(after.canSeeCapturedInput).toBe(false);
    });
  });

  describe("when input is restricted to admins", () => {
    beforeEach(async () => {
      await service.setForScope({
        scope: { scopeType: "PROJECT", scopeId: project.id },
        personalOnly: false,
        config: {
          categories: { input: { disposition: "restrict", audience: { admins: true } } },
        },
      });
    });

    /** @scenario The redaction placeholder explains why content is hidden */
    it("hides input from a member and names the audience that can see it", async () => {
      const member = await protections(memberUserId);
      expect(member.canSeeCapturedInput).toBe(false);
      expect(member.capturedInputVisibleTo).toBe("Admins");
    });

    it("shows input to an admin with no redaction reason", async () => {
      const admin = await protections(adminUserId);
      expect(admin.canSeeCapturedInput).toBe(true);
      expect(admin.capturedInputVisibleTo).toBeNull();
    });
  });
});
