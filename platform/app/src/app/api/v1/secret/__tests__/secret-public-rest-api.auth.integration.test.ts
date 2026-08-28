/** @vitest-environment node */
import { nanoid } from "nanoid";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { Hono } from "hono";
import {
  type Organization,
  type Project,
  RoleBindingScopeType,
  type Team,
  TeamUserRole,
} from "~/generated/prisma/client";
import { appContextMiddlewareFor } from "~/app/api/middleware/app-context";
import { projectFactory } from "~/factories/project.factory";
import { getApp } from "~/server/app-layer/app";
import { prisma } from "~/server/db";
import { wireDefaultTestApp } from "~/test-utils/wireDefaultTestApp";
import { secretPublicRestApp as secretApp } from "~/runtime/app/features/secret";

wireDefaultTestApp();

describe("Secret modern REST authentication", () => {
  const namespace = nanoid(8);
  let api: Hono;
  let organization: Organization;
  let team: Team;
  let project: Project;
  let otherProject: Project;
  let permittedToken: string;
  let deniedToken: string;

  const request = (path: string, token = permittedToken) =>
    api.request(path, {
      headers: {
        Authorization: `Bearer ${token}`,
        "X-Project-Id": project.id,
      },
    });

  beforeAll(async () => {
    const app = getApp();
    api = new Hono();
    api.use("*", appContextMiddlewareFor(app));
    api.route("/", secretApp);

    organization = await prisma.organization.create({
      data: { name: "Secret REST auth", slug: `secret-rest-auth-${namespace}` },
    });
    team = await prisma.team.create({
      data: {
        name: "Secret REST auth",
        slug: `secret-rest-auth-${namespace}`,
        organizationId: organization.id,
      },
    });
    project = await prisma.project.create({
      data: {
        ...projectFactory.build({ slug: `secret-rest-auth-${namespace}` }),
        teamId: team.id,
        personalFeatures: {},
      },
    });
    otherProject = await prisma.project.create({
      data: {
        ...projectFactory.build({ slug: `secret-rest-other-${namespace}` }),
        teamId: team.id,
        personalFeatures: {},
      },
    });

    const permitted = await app.apiKeys.create({
      name: `secret-rest-permitted-${namespace}`,
      organizationId: organization.id,
      permissionMode: "all",
      bindings: [
        {
          role: TeamUserRole.ADMIN,
          scopeType: RoleBindingScopeType.ORGANIZATION,
          scopeId: organization.id,
        },
      ],
    });
    permittedToken = permitted.token;

    const denied = await app.apiKeys.create({
      name: `secret-rest-denied-${namespace}`,
      organizationId: organization.id,
      permissionMode: "restricted",
      permissions: ["traces:view"],
      bindings: [
        {
          role: TeamUserRole.CUSTOM,
          scopeType: RoleBindingScopeType.ORGANIZATION,
          scopeId: organization.id,
        },
      ],
    });
    deniedToken = denied.token;
  });

  afterAll(async () => {
    if (!organization) return;
    const projectIds = [project?.id, otherProject?.id].filter((projectId): projectId is string =>
      Boolean(projectId),
    );
    await prisma.projectSecret.deleteMany({
      where: { projectId: { in: projectIds } },
    });
    await prisma.roleBinding.deleteMany({ where: { organizationId: organization.id } });
    await prisma.apiKey.deleteMany({ where: { organizationId: organization.id } });
    await prisma.customRole.deleteMany({ where: { organizationId: organization.id } });
    await prisma.project.deleteMany({ where: { teamId: team.id } });
    await prisma.team.deleteMany({ where: { id: team.id } });
    await prisma.organization.deleteMany({ where: { id: organization.id } });
  });

  it("resolves a Bearer credential and X-Project-Id before listing its validated project", async () => {
    const response = await request(`/api/v1/secret?projectId=${project.id}`);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual([]);
  });

  it("refuses a credential that lacks the declared secrets:view permission", async () => {
    const response = await request(`/api/v1/secret?projectId=${project.id}`, deniedToken);

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({
      code: "api_key_permission_denied",
      retryable: false,
    });
  });

  it("refuses validated input that disagrees with the header-selected project", async () => {
    const response = await request(`/api/v1/secret?projectId=${otherProject.id}`);

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({
      code: "project_input_mismatch",
      retryable: false,
    });
  });

  it("sanitizes infrastructure failures in authentication and service dispatch", async () => {
    const authenticationFailure = vi
      .spyOn(getApp().apiKeys, "tryResolveToken")
      .mockRejectedValueOnce(new Error("database password must-not-leak"));
    const authenticationResponse = await request(`/api/v1/secret?projectId=${project.id}`);
    authenticationFailure.mockRestore();

    const serviceFailure = vi
      .spyOn(getApp().secrets, "list")
      .mockRejectedValueOnce(new Error("postgres connection string must-not-leak"));
    const serviceResponse = await request(`/api/v1/secret?projectId=${project.id}`);
    serviceFailure.mockRestore();

    expect(authenticationResponse.status).toBe(500);
    const authenticationBody = await authenticationResponse.text();
    expect(authenticationBody).toContain("internal_error");
    expect(authenticationBody).not.toContain("must-not-leak");
    expect(serviceResponse.status).toBe(500);
    const serviceBody = await serviceResponse.text();
    expect(serviceBody).toContain("internal_error");
    expect(serviceBody).not.toContain("must-not-leak");
  });
});
