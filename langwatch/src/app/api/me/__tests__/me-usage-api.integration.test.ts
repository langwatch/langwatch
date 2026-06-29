import {
  OrganizationUserRole,
  RoleBindingScopeType,
  TeamUserRole,
  type Organization,
  type Team,
} from "@prisma/client";
import { generate } from "@langwatch/ksuid";
import { nanoid } from "nanoid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { KSUID_RESOURCES } from "~/utils/constants";
import { prisma } from "~/server/db";
import { ApiKeyService } from "~/server/api-key/api-key.service";
import { app } from "../[[...route]]/app";

describe("Feature: Personal usage REST API", () => {
  const ns = `me-usage-api-${nanoid(8)}`;

  let testOrganization: Organization;
  let testTeam: Team;
  let personalProjectId: string;
  let sharedProjectId: string;
  let personalToken: string;
  let sharedToken: string;
  let userId: string;

  const authHeaders = (token: string, projectId: string) => ({
    Authorization: `Bearer ${token}`,
    "X-Project-Id": projectId,
    "Content-Type": "application/json",
  });

  const mintToken = async () =>
    (
      await ApiKeyService.create(prisma).create({
        name: `me-usage-bootstrap-${nanoid(6)}`,
        userId,
        createdByUserId: userId,
        organizationId: testOrganization.id,
        permissionMode: "all",
        bindings: [
          {
            role: TeamUserRole.ADMIN,
            scopeType: RoleBindingScopeType.ORGANIZATION,
            scopeId: testOrganization.id,
          },
        ],
      })
    ).token;

  beforeAll(async () => {
    testOrganization = await prisma.organization.create({
      data: { name: "Me Usage Test Org", slug: `--test-org-${ns}` },
    });
    testTeam = await prisma.team.create({
      data: {
        name: "Me Usage Test Team",
        slug: `--test-team-${ns}`,
        organizationId: testOrganization.id,
      },
    });
    const user = await prisma.user.create({
      data: { name: "Test User", email: `test-${ns}@example.com` },
    });
    userId = user.id;
    await prisma.organizationUser.create({
      data: {
        userId,
        organizationId: testOrganization.id,
        role: OrganizationUserRole.ADMIN,
      },
    });
    await prisma.teamUser.create({
      data: { userId, teamId: testTeam.id, role: TeamUserRole.ADMIN },
    });
    await prisma.roleBinding.create({
      data: {
        id: generate(KSUID_RESOURCES.ROLE_BINDING).toString(),
        organizationId: testOrganization.id,
        userId,
        role: TeamUserRole.ADMIN,
        scopeType: RoleBindingScopeType.ORGANIZATION,
        scopeId: testOrganization.id,
      },
    });

    const personalProject = await prisma.project.create({
      data: {
        id: `project_${nanoid()}`,
        name: "Personal Workspace",
        slug: `--test-personal-${ns}`,
        language: "typescript",
        framework: "other",
        apiKey: `sk-lw-${nanoid(48)}`,
        teamId: testTeam.id,
        isPersonal: true,
        ownerUserId: userId,
      },
    });
    personalProjectId = personalProject.id;

    const sharedProject = await prisma.project.create({
      data: {
        id: `project_${nanoid()}`,
        name: "Shared Project",
        slug: `--test-shared-${ns}`,
        language: "typescript",
        framework: "other",
        apiKey: `sk-lw-${nanoid(48)}`,
        teamId: testTeam.id,
        isPersonal: false,
      },
    });
    sharedProjectId = sharedProject.id;

    personalToken = await mintToken();
    sharedToken = await mintToken();
  });

  afterAll(async () => {
    await prisma.roleBinding
      .deleteMany({ where: { organizationId: testOrganization.id } })
      .catch(() => {});
    await prisma.apiKey.deleteMany({ where: { userId } }).catch(() => {});
    await prisma.project
      .deleteMany({ where: { teamId: testTeam.id } })
      .catch(() => {});
    await prisma.teamUser
      .deleteMany({ where: { teamId: testTeam.id } })
      .catch(() => {});
    await prisma.organizationUser
      .deleteMany({ where: { organizationId: testOrganization.id } })
      .catch(() => {});
    await prisma.user.delete({ where: { id: userId } }).catch(() => {});
    await prisma.team.delete({ where: { id: testTeam.id } }).catch(() => {});
    await prisma.organization
      .delete({ where: { id: testOrganization.id } })
      .catch(() => {});
  });

  describe("when no auth header is provided", () => {
    it("returns 401", async () => {
      const headers = new Headers();
      headers.set("X-Project-Id", personalProjectId);
      const res = await app.request("/api/me/usage", { headers });
      expect(res.status).toBe(401);
    });
  });

  describe("when the project key is a personal-project key", () => {
    it("returns the personal-usage envelope (empty-state safe)", async () => {
      const res = await app.request("/api/me/usage", {
        headers: authHeaders(personalToken, personalProjectId),
      });
      expect(res.status).toBe(200);
      const body = await res.json();

      expect(body.summary).toMatchObject({
        spentUsd: 0,
        billedUsd: 0,
        requests: 0,
        promptTokens: 0,
        completionTokens: 0,
        mostUsedModel: null,
      });
      expect(Array.isArray(body.dailyBuckets)).toBe(true);
      expect(Array.isArray(body.breakdownByModel)).toBe(true);
      expect(body.breakdownByModel).toEqual([]);
    });

    it("accepts an explicit window via query params", async () => {
      const end = 1_700_000_000_000;
      const start = end - 7 * 24 * 60 * 60 * 1000;
      const res = await app.request(
        `/api/me/usage?windowStartMs=${start}&windowEndMs=${end}`,
        { headers: authHeaders(personalToken, personalProjectId) },
      );
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.summary.spentUsd).toBe(0);
    });
  });

  describe("when the project key is a shared (non-personal) project key", () => {
    it("returns 400 explaining a personal-project key is required", async () => {
      const res = await app.request("/api/me/usage", {
        headers: authHeaders(sharedToken, sharedProjectId),
      });
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(JSON.stringify(body)).toContain("personal-project");
    });
  });
});
