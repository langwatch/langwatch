/**
 * @vitest-environment node
 *
 * GET /api/projects returns exactly the projects the credential can view:
 * an org-reaching key keeps the full listing, a narrower key gets a 200
 * with the filtered list (key bindings ∩ owner ceiling), never a 403.
 * Real Postgres, no mocks.
 *
 * Spec: specs/ai-governance/cli-onboarding/login-user-scoped-key.feature
 */
import { generate } from "@langwatch/ksuid";
import { nanoid } from "nanoid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  OrganizationUserRole,
  RoleBindingScopeType,
  TeamUserRole,
} from "~/generated/prisma/client";
import { ApiKeyService } from "~/server/api-key/api-key.service";
import { prisma } from "~/server/db";
import { cleanupTestRows } from "~/test-utils/cleanupTestRows";
import { KSUID_RESOURCES } from "~/utils/constants";
import { app } from "../[[...route]]/app";

describe("Feature: GET /api/projects honours the credential's reach", () => {
  const ns = `projects-reach-${nanoid(8)}`;

  let organizationId: string;
  let teamAId: string;
  let teamBId: string;
  let adminId: string;
  let memberId: string;
  const projectIds: string[] = [];
  const teamAProjectIds: string[] = [];
  const teamBProjectIds: string[] = [];

  const listAs = async (token: string) => {
    const res = await app.request("/api/projects?limit=100", {
      headers: { Authorization: `Bearer ${token}` },
    });
    return {
      status: res.status,
      json: (await res.json()) as {
        data?: Array<{ id: string }>;
        pagination?: { total: number };
      },
    };
  };

  const mintKey = async (args: {
    userId: string;
    bindings: Array<{
      scopeType: "ORGANIZATION" | "TEAM" | "PROJECT";
      scopeId: string;
    }>;
    permissions?: string[];
  }) =>
    (
      await ApiKeyService.create(prisma).create({
        name: `reach-${nanoid(6)}`,
        userId: args.userId,
        createdByUserId: args.userId,
        organizationId,
        permissionMode: "restricted",
        permissions: args.permissions ?? ["project:view", "traces:view"],
        bindings: args.bindings.map((binding) => ({
          role: TeamUserRole.CUSTOM,
          scopeType: RoleBindingScopeType[binding.scopeType],
          scopeId: binding.scopeId,
        })),
      })
    ).token;

  beforeAll(async () => {
    const organization = await prisma.organization.create({
      data: { name: "Projects Reach Org", slug: `--test-org-${ns}` },
    });
    organizationId = organization.id;

    const teamA = await prisma.team.create({
      data: {
        name: "Reach Team A",
        slug: `--test-team-a-${ns}`,
        organizationId,
      },
    });
    teamAId = teamA.id;
    const teamB = await prisma.team.create({
      data: {
        name: "Reach Team B",
        slug: `--test-team-b-${ns}`,
        organizationId,
      },
    });
    teamBId = teamB.id;

    const admin = await prisma.user.create({
      data: { name: "Reach Admin", email: `reach-admin-${ns}@example.com` },
    });
    adminId = admin.id;
    const member = await prisma.user.create({
      data: { name: "Reach Member", email: `reach-member-${ns}@example.com` },
    });
    memberId = member.id;

    await prisma.organizationUser.createMany({
      data: [
        { userId: adminId, organizationId, role: OrganizationUserRole.ADMIN },
        { userId: memberId, organizationId, role: OrganizationUserRole.MEMBER },
      ],
    });
    await prisma.roleBinding.createMany({
      data: [
        {
          id: generate(KSUID_RESOURCES.ROLE_BINDING).toString(),
          organizationId,
          userId: adminId,
          role: TeamUserRole.ADMIN,
          scopeType: RoleBindingScopeType.ORGANIZATION,
          scopeId: organizationId,
        },
        {
          id: generate(KSUID_RESOURCES.ROLE_BINDING).toString(),
          organizationId,
          userId: memberId,
          role: TeamUserRole.ADMIN,
          scopeType: RoleBindingScopeType.TEAM,
          scopeId: teamAId,
        },
      ],
    });

    // Five projects: three in team A, two in team B.
    for (const [index, teamId] of [
      teamAId,
      teamAId,
      teamAId,
      teamBId,
      teamBId,
    ].entries()) {
      const project = await prisma.project.create({
        data: {
          name: `Reach Project ${index}`,
          slug: `--test-reach-${index}-${ns}`,
          apiKey: `test-reach-${index}-${ns}`,
          teamId,
          language: "typescript",
          framework: "openai",
        },
      });
      projectIds.push(project.id);
      (teamId === teamAId ? teamAProjectIds : teamBProjectIds).push(project.id);
    }
  });

  afterAll(async () => {
    // Setup died before the fixture existed. Every filter below would carry
    // `undefined`, which Prisma drops from the where clause, turning these
    // into unscoped deletes against the shared integration database.
    if (!organizationId) return;

    await cleanupTestRows(prisma, [
      ["roleBinding", { organizationId }],
      ["apiKey", { organizationId }],
      ["customRole", { organizationId }],
      ["project", { team: { organizationId } }],
      ["teamUser", { team: { organizationId } }],
      ["organizationUser", { organizationId }],
      ["team", { organizationId }],
    ]);
    const userIds = [adminId, memberId].filter(Boolean);
    if (userIds.length > 0) {
      await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    }
    await prisma.organization.delete({ where: { id: organizationId } });
  });

  describe("given a CLI key with an ORGANIZATION-scoped binding granting project:view", () => {
    /** @scenario "org-scoped key lists every project in the organization" */
    it("lists every non-archived project in the organization", async () => {
      const token = await mintKey({
        userId: adminId,
        bindings: [{ scopeType: "ORGANIZATION", scopeId: organizationId }],
      });

      const { status, json } = await listAs(token);

      expect(status).toBe(200);
      expect(json.data!.map((project) => project.id).sort()).toEqual(
        [...projectIds].sort(),
      );
    });
  });

  describe("given a CLI key bound to two of the organization's five projects", () => {
    /** @scenario "project-scoped key gets a filtered list, not a refusal" */
    it("answers 200 with exactly those two projects", async () => {
      const bound = [teamAProjectIds[0]!, teamBProjectIds[0]!];
      const token = await mintKey({
        userId: adminId,
        bindings: bound.map((scopeId) => ({
          scopeType: "PROJECT" as const,
          scopeId,
        })),
      });

      const { status, json } = await listAs(token);

      expect(status).toBe(200);
      expect(json.data!.map((project) => project.id).sort()).toEqual(
        [...bound].sort(),
      );
      expect(json.pagination!.total).toBe(2);
    });
  });

  describe("given an org-wide key whose owner has lost access to one team", () => {
    /** @scenario "the filtered list respects the owner's ceiling" */
    it("omits the projects of the team the owner can no longer view", async () => {
      // The member holds team A only, but an admin-created key can be bound
      // org-wide only within the OWNER's ceiling — so mint it while the
      // member briefly holds an org-wide binding, then take that binding
      // away, exactly like a demotion after login.
      const temporary = await prisma.roleBinding.create({
        data: {
          id: generate(KSUID_RESOURCES.ROLE_BINDING).toString(),
          organizationId,
          userId: memberId,
          role: TeamUserRole.ADMIN,
          scopeType: RoleBindingScopeType.ORGANIZATION,
          scopeId: organizationId,
        },
      });
      const token = await mintKey({
        userId: memberId,
        bindings: [{ scopeType: "ORGANIZATION", scopeId: organizationId }],
      });
      await prisma.roleBinding.delete({ where: { id: temporary.id } });

      const { status, json } = await listAs(token);

      expect(status).toBe(200);
      const listed = json.data!.map((project) => project.id).sort();
      expect(listed).toEqual([...teamAProjectIds].sort());
      for (const absent of teamBProjectIds) {
        expect(listed).not.toContain(absent);
      }
    });
  });

  describe("given a key whose bindings grant no project:view at all", () => {
    /** @scenario "a key without project:view gets an empty list, not a refusal" */
    it("answers 200 with an empty list rather than a refusal", async () => {
      const token = await mintKey({
        userId: memberId,
        bindings: [{ scopeType: "TEAM", scopeId: teamAId }],
        permissions: ["traces:view"],
      });

      const { status, json } = await listAs(token);

      expect(status).toBe(200);
      expect(json.data).toEqual([]);
      expect(json.pagination!.total).toBe(0);
    });
  });
});
