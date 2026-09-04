/**
 * @vitest-environment node
 *
 * @see specs/ai-gateway/governance/personal-workspace-integrity.feature
 *
 * A seat decision leaves a member's personal workspace alone, and it costs
 * nothing to, because the organization role already decides what they can do
 * inside it: a Lite Member reads their workspace and writes nothing while
 * holding the same ADMIN binding on it they always did, so giving them their
 * full access back restores writing with nothing to repair.
 *
 * That is also why the workspace is kept out of the access an admin manages:
 * it is not a grant anyone chose, and nothing an admin does to it is allowed.
 *
 * Ported from `personal-workspace-invariants.integration.test.ts` on
 * platform/app, which asked the deleted `hasProjectPermission` and the
 * deleted `roleBinding.listForUser` / `listForOrg`. Both answers live on
 * `AuthzService` now, over the same rows.
 *
 * Requires DATABASE_URL, the variable this package's integration lane reads.
 * Skips cleanly without it.
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaDriverAdapterService } from "@langwatch/prisma-client";
import { PrismaClient } from "@langwatch/prisma-client/generated";
import {
  PrismaAuthzBindingRepository,
  type AuthzBindingDatabase,
} from "../../repositories/prisma/prisma.authz-binding.repository";
import { PrismaAuthzListingRepository } from "../../repositories/prisma/prisma.authz-listing.repository";
import { PrismaAuthzReadRepository } from "../../repositories/prisma/prisma.authz-read.repository";
import type { AuthzDatabase } from "../../repositories/authz-read.repository";
import { AuthzService } from "../authz.service";

const DB_URL = process.env.DATABASE_URL;

const uniqueSuffix = () => randomUUID().replaceAll("-", "").slice(0, 12);

describe.skipIf(!DB_URL)("given a member with a personal workspace in an organization", () => {
  const prisma = new PrismaClient({
    adapter: PrismaDriverAdapterService.create().create(DB_URL ?? "").adapter,
  });
  const database = prisma as unknown as AuthzDatabase;
  const authz = AuthzService.create({
    repository: PrismaAuthzReadRepository.create(database),
    listing: PrismaAuthzListingRepository.create(database),
    bindings: PrismaAuthzBindingRepository.create(prisma as unknown as AuthzBindingDatabase),
    // The legacy RoleBinding head, which is what these rows are. No cache is
    // configured either, so each read below sees the role as it stands.
    isOnEngine: async () => false,
  });

  const testNamespace = `pw-lite-${uniqueSuffix()}`;
  let organizationId: string;
  let seatUserId: string;
  let personalTeamId: string;
  let personalProjectId: string;
  let sharedTeamId: string;

  const setOrganizationRole = (role: "MEMBER" | "EXTERNAL") =>
    prisma.organizationUser.update({
      where: { userId_organizationId: { userId: seatUserId, organizationId } },
      data: { role },
    });

  const canWriteToOwnWorkspace = () =>
    authz.hasPermission({
      userId: seatUserId,
      permission: "datasets:create",
      projectId: personalProjectId,
    });

  beforeAll(async () => {
    const seatUser = await prisma.user.create({
      data: { name: "Seat User", email: `seat-${testNamespace}@example.com` },
    });
    seatUserId = seatUser.id;

    const organization = await prisma.organization.create({
      data: { name: `ACME ${testNamespace}`, slug: `--test-org-${testNamespace}` },
    });
    organizationId = organization.id;

    // A live membership: the binding read fences on one, so a disabled or
    // missing row would answer "no permission" for the wrong reason.
    await prisma.organizationUser.create({
      data: { userId: seatUserId, organizationId, role: "EXTERNAL" },
    });

    const personalTeam = await prisma.team.create({
      data: {
        name: "Seat User's Workspace",
        slug: `--test-team-${testNamespace}-personal`,
        organizationId,
        isPersonal: true,
        ownerUserId: seatUserId,
      },
    });
    personalTeamId = personalTeam.id;

    const personalProject = await prisma.project.create({
      data: {
        name: "Personal",
        slug: `--test-proj-${testNamespace}-personal`,
        apiKey: `sk-lw-test-${uniqueSuffix()}`,
        teamId: personalTeamId,
        language: "en",
        framework: "test",
        isPersonal: true,
      },
    });
    personalProjectId = personalProject.id;

    const sharedTeam = await prisma.team.create({
      data: {
        name: `ACME ${testNamespace}`,
        slug: `--test-team-${testNamespace}-shared`,
        organizationId,
      },
    });
    sharedTeamId = sharedTeam.id;

    await prisma.roleBinding.createMany({
      data: [
        {
          userId: seatUserId,
          organizationId,
          role: "ADMIN",
          scopeType: "TEAM",
          scopeId: personalTeamId,
        },
        {
          userId: seatUserId,
          organizationId,
          role: "VIEWER",
          scopeType: "TEAM",
          scopeId: sharedTeamId,
        },
      ],
    });
  });

  afterAll(async () => {
    if (!organizationId) return;
    await prisma.project.deleteMany({ where: { team: { organizationId } } });
    await prisma.roleBinding.deleteMany({ where: { organizationId } });
    await prisma.organizationUser.deleteMany({ where: { organizationId } });
    await prisma.team.deleteMany({ where: { organizationId } });
    await prisma.organization.deleteMany({ where: { id: organizationId } });
    await prisma.user.deleteMany({ where: { id: seatUserId } });
    await prisma.$disconnect();
  });

  describe("when that member holds a Lite Member seat", () => {
    beforeAll(async () => {
      await setOrganizationRole("EXTERNAL");
    });

    /** @scenario A Lite Member reads their own personal workspace but cannot write to it */
    it("still lets them read their own workspace", async () => {
      await expect(
        authz.hasPermission({
          userId: seatUserId,
          permission: "datasets:view",
          projectId: personalProjectId,
        }),
      ).resolves.toBe(true);
    });

    /** @scenario A Lite Member reads their own personal workspace but cannot write to it */
    it("stops them writing to it, admin binding and all", async () => {
      await expect(canWriteToOwnWorkspace()).resolves.toBe(false);
    });

    /** @scenario A personal workspace is not listed among the access an admin manages */
    it("keeps the workspace out of the access an admin is shown for them", async () => {
      const managed = await authz.listManagedBindingsForUser({
        organizationId,
        userId: seatUserId,
      });
      const scopeIds = managed.map((binding) => binding.scopeId);

      expect(scopeIds).not.toContain(personalTeamId);
      // The shared team is still there: this hides what cannot be managed,
      // not everything about the member.
      expect(scopeIds).toContain(sharedTeamId);
    });

    /** @scenario A personal workspace is not listed among the access an admin manages */
    it("keeps every member's workspace out of the organization-wide list", async () => {
      const managed = await authz.listManagedBindingsForOrganization({ organizationId });

      expect(managed.map((binding) => binding.scopeId)).not.toContain(personalTeamId);
    });
  });

  describe("when an admin gives that member their full access back", () => {
    /** @scenario Giving a Lite Member their full access back restores writing in their own workspace */
    it("lets them write again once they are a member, with nothing to repair", async () => {
      await setOrganizationRole("EXTERNAL");
      await expect(canWriteToOwnWorkspace()).resolves.toBe(false);

      await setOrganizationRole("MEMBER");

      await expect(canWriteToOwnWorkspace()).resolves.toBe(true);
    });
  });
});
