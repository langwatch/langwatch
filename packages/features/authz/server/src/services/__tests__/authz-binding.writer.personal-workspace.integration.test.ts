/**
 * @vitest-environment node
 *
 * @see specs/ai-gateway/governance/personal-workspace-integrity.feature
 *
 * A personal workspace holds exactly one member, its owner, and role bindings
 * are the general form of "who reaches this scope". Every binding write is
 * therefore refused on a personal scope: granting a second person or a group
 * leaves the team flagged personal while it is shared in every way that
 * matters, and revoking or re-roling the owner's own binding takes the owner
 * out of the only workspace they have.
 *
 * Ported from `personal-workspace-invariants.integration.test.ts` on
 * platform/app, which drove the deleted `appRouter`'s `roleBinding.*` and
 * `group.addBinding` procedures. The refusal moved into
 * `AuthzBindingWriterService`, which is where every one of those entry points
 * lands now.
 *
 * The ledger throws on contact, so a refusal that arrived by any other route
 * than the guard would fail loudly rather than read as a pass; each case also
 * reads the rows back to prove nothing landed.
 *
 * Requires DATABASE_URL, the variable this package's integration lane reads.
 * Skips cleanly without it.
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaDriverAdapterService } from "@langwatch/prisma-client";
import { PrismaClient } from "@langwatch/prisma-client/generated";
import type { AuthzCompatibilityLedgerPort } from "../../ports/authz-compatibility-ledger.port";
import {
  PrismaAuthzBindingRepository,
  type AuthzBindingDatabase,
} from "../../repositories/prisma/prisma.authz-binding.repository";
import { AuthzBindingWriterService } from "../authz-binding-writer.service";

const DB_URL = process.env.DATABASE_URL;

const uniqueSuffix = () => randomUUID().replaceAll("-", "").slice(0, 12);

const LEDGER_REACHED = "the grants ledger must not be reached on a personal scope";

/** Any write that gets past the guard fails here, and says so. */
const refusingLedger = new Proxy(
  {},
  {
    get: () => () => Promise.reject(new Error(LEDGER_REACHED)),
  },
) as unknown as AuthzCompatibilityLedgerPort;

describe.skipIf(!DB_URL)("given a personal workspace in an organization", () => {
  const prisma = new PrismaClient({
    adapter: PrismaDriverAdapterService.create().create(DB_URL ?? "").adapter,
  });
  const bindings = PrismaAuthzBindingRepository.create(prisma as unknown as AuthzBindingDatabase);
  const writer = AuthzBindingWriterService.create({
    bindings,
    ledger: refusingLedger,
    newBindingId: () => `binding_${uniqueSuffix()}`,
  });

  const testNamespace = `pw-binding-${uniqueSuffix()}`;
  const actor = { type: "user" as const, id: null };

  let organizationId: string;
  let ownerUserId: string;
  let colleagueUserId: string;
  let groupId: string;
  let personalTeamId: string;
  let personalTeamName: string;
  let personalProjectId: string;
  let ownerBindingId: string;

  const bindingsOnPersonalTeam = () =>
    prisma.roleBinding.findMany({
      where: { organizationId, scopeType: "TEAM", scopeId: personalTeamId },
      select: { id: true, userId: true, groupId: true, role: true },
    });

  beforeAll(async () => {
    const owner = await prisma.user.create({
      data: { name: "Workspace Owner", email: `owner-${testNamespace}@example.com` },
    });
    ownerUserId = owner.id;
    const colleague = await prisma.user.create({
      data: { name: "Colleague", email: `colleague-${testNamespace}@example.com` },
    });
    colleagueUserId = colleague.id;

    const organization = await prisma.organization.create({
      data: { name: `ACME ${testNamespace}`, slug: `--test-org-${testNamespace}` },
    });
    organizationId = organization.id;

    for (const userId of [ownerUserId, colleagueUserId]) {
      await prisma.organizationUser.create({
        data: { userId, organizationId, role: "ADMIN" },
      });
    }

    const group = await prisma.group.create({
      data: {
        id: `group_${uniqueSuffix()}`,
        organizationId,
        name: `Everyone ${testNamespace}`,
        slug: `--everyone-${testNamespace}`,
      },
    });
    groupId = group.id;

    personalTeamName = "Workspace Owner's Workspace";
    const personalTeam = await prisma.team.create({
      data: {
        name: personalTeamName,
        slug: `--test-team-${testNamespace}-personal`,
        organizationId,
        isPersonal: true,
        ownerUserId,
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

    const ownerBinding = await prisma.roleBinding.create({
      data: {
        userId: ownerUserId,
        organizationId,
        role: "ADMIN",
        scopeType: "TEAM",
        scopeId: personalTeamId,
      },
    });
    ownerBindingId = ownerBinding.id;
  });

  afterAll(async () => {
    if (!organizationId) return;
    await prisma.project.deleteMany({ where: { team: { organizationId } } });
    await prisma.roleBinding.deleteMany({ where: { organizationId } });
    await prisma.groupMembership.deleteMany({ where: { groupId } });
    await prisma.group.deleteMany({ where: { organizationId } });
    await prisma.organizationUser.deleteMany({ where: { organizationId } });
    await prisma.team.deleteMany({ where: { organizationId } });
    await prisma.organization.deleteMany({ where: { id: organizationId } });
    await prisma.user.deleteMany({ where: { id: { in: [ownerUserId, colleagueUserId] } } });
    await prisma.$disconnect();
  });

  describe("when a manager grants a second person access to the personal workspace", () => {
    /** @scenario Giving someone else access to a personal workspace is refused */
    it("refuses a binding naming the personal team", async () => {
      await expect(
        writer.create({
          organizationId,
          userId: colleagueUserId,
          role: "MEMBER",
          scopeType: "TEAM",
          scopeId: personalTeamId,
          actor,
        }),
      ).rejects.toMatchObject({ code: "personal_workspace_not_managed_here" });

      await expect(bindingsOnPersonalTeam()).resolves.toEqual([
        { id: ownerBindingId, userId: ownerUserId, groupId: null, role: "ADMIN" },
      ]);
    });

    /** @scenario Giving someone else access to a personal workspace is refused */
    it("refuses a binding that names the personal project instead of the team", async () => {
      await expect(
        writer.create({
          organizationId,
          userId: colleagueUserId,
          role: "MEMBER",
          scopeType: "PROJECT",
          scopeId: personalProjectId,
          actor,
        }),
      ).rejects.toMatchObject({ code: "personal_workspace_not_managed_here" });

      await expect(
        prisma.roleBinding.findMany({
          where: { organizationId, scopeType: "PROJECT", scopeId: personalProjectId },
          select: { id: true },
        }),
      ).resolves.toEqual([]);
    });
  });

  describe("when a manager grants a group access to the personal workspace", () => {
    /** @scenario Giving a group access to a personal workspace is refused */
    it("refuses the group binding, which would make the workspace multi-member by proxy", async () => {
      await expect(
        writer.create({
          organizationId,
          groupId,
          role: "ADMIN",
          scopeType: "TEAM",
          scopeId: personalTeamId,
          actor,
        }),
      ).rejects.toMatchObject({ code: "personal_workspace_not_managed_here" });

      await expect(bindingsOnPersonalTeam()).resolves.toEqual([
        { id: ownerBindingId, userId: ownerUserId, groupId: null, role: "ADMIN" },
      ]);
    });
  });

  describe("when a manager takes the owner's own access away", () => {
    /** @scenario Taking the owner's access to their own workspace away is refused */
    it("refuses the deletion of the owner's binding", async () => {
      await expect(
        writer.delete({ organizationId, bindingId: ownerBindingId, actor }),
      ).rejects.toMatchObject({ code: "personal_workspace_not_managed_here" });

      await expect(bindingsOnPersonalTeam()).resolves.toEqual([
        { id: ownerBindingId, userId: ownerUserId, groupId: null, role: "ADMIN" },
      ]);
    });
  });

  describe("when a manager changes the owner's role on their own workspace", () => {
    /** @scenario Changing the owner's role on their own workspace is refused */
    it("refuses the demotion and leaves the owner an admin of it", async () => {
      await expect(
        writer.update({ organizationId, bindingId: ownerBindingId, role: "VIEWER", actor }),
      ).rejects.toMatchObject({ code: "personal_workspace_not_managed_here" });

      await expect(bindingsOnPersonalTeam()).resolves.toEqual([
        { id: ownerBindingId, userId: ownerUserId, groupId: null, role: "ADMIN" },
      ]);
    });

    /** @scenario Refusing a change to a personal workspace says whose workspace it is */
    it("names the workspace so an admin knows whose it is", async () => {
      const error = await writer
        .update({ organizationId, bindingId: ownerBindingId, role: "VIEWER", actor })
        .catch((caught: unknown) => caught);

      // "a personal workspace" leaves an admin looking for the one they hit
      // among as many as the organization has members.
      expect(error).toMatchObject({
        code: "personal_workspace_not_managed_here",
        meta: { ownerName: personalTeamName },
      });
    });
  });
});
