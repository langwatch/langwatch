import {
  LANGY_SESSION_API_KEY_NAME,
  type ApiKeyApi,
  type ApiKeyVerification,
  type ResolvedApiKeyCredential,
} from "@langwatch/api-key-contract";
import type { AuthzApi } from "@langwatch/authz-contract";
import type { ProjectApi } from "@langwatch/project-contract";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { describe, expect, it, vi } from "vitest";
import { ConnectedAgentCredentialService } from "../connected-agent-credential.service.ts";

const project = {
  id: "project_1",
  name: "Project One",
  slug: "project-one",
  teamId: "team_1",
  organizationId: "org_1",
  isPersonal: false,
  ownerUserId: null,
};

function build() {
  const token: ResolvedApiKeyCredential = {
    type: "apiKey",
    apiKeyId: "key_1",
    userId: "user_1",
    organizationId: "org_1",
    ingestSourceType: null,
    ingestionTemplateId: null,
    isLangySessionKey: false,
    project,
  };
  const key: ApiKeyVerification = {
    id: "key_1",
    name: "Personal key",
    description: null,
    organizationId: "org_1",
    userId: "user_1",
    createdByUserId: "user_1",
    createdByDeviceLabel: null,
    lookupId: "lookup_1",
    permissionMode: "all",
    expiresAt: null,
    revokedAt: null,
    lastUsedAt: null,
    ingestSourceType: null,
    ingestionTemplateId: null,
    createdAt: new Date("2026-01-01"),
    updatedAt: new Date("2026-01-01"),
    roleBindings: [],
    tokenType: "apiKey",
  };
  const resolve = vi.fn().mockResolvedValue(token);
  const verify = vi.fn<ApiKeyApi["findVerifiedToken"]>().mockResolvedValue(key);
  const authorize = vi.fn().mockResolvedValue(true);
  const listProjects = vi.fn().mockResolvedValue({ data: [project] });
  const service = ConnectedAgentCredentialService.create({
    apiKeys: createApiFixture<ApiKeyApi>({
      findResolvedToken: resolve,
      findVerifiedToken: verify,
    }),
    authz: createApiFixture<AuthzApi>({ hasApiKeyPermission: authorize }),
    projects: createApiFixture<ProjectApi>({ listByOrganization: listProjects }),
  });

  return { service, token, key, resolve, verify, authorize, listProjects };
}

describe("ConnectedAgentCredentialService", () => {
  it.each([{ ingestionTemplateId: "ingestion_1" }, { isLangySessionKey: true }])(
    "refuses unsupported key kinds before permission lookup: %j",
    async (change) => {
      const fixture = build();
      fixture.resolve.mockResolvedValue({ ...fixture.token, ...change });

      await expect(
        fixture.service.resolve({ token: "secret", projectId: project.id }),
      ).rejects.toMatchObject({
        meta: { reason: "key_type_not_allowed" },
      });
      expect(fixture.authorize).not.toHaveBeenCalled();
    },
  );

  it("checks scenarios:manage against the resolved project and key", async () => {
    const fixture = build();
    fixture.authorize.mockResolvedValue(false);

    await expect(
      fixture.service.resolve({ token: "secret", projectId: project.id }),
    ).rejects.toMatchObject({
      meta: { reason: "permission_denied" },
    });
    expect(fixture.authorize).toHaveBeenCalledWith({
      apiKeyId: "key_1",
      userId: "user_1",
      organizationId: "org_1",
      scope: { type: "project", id: project.id, teamId: project.teamId },
      permission: "scenarios:manage",
    });
  });

  it("returns the personal identity without exposing credential material", async () => {
    const fixture = build();

    await expect(
      fixture.service.resolve({ token: "secret", projectId: project.id }),
    ).resolves.toEqual({
      project: { id: project.id, slug: project.slug },
      userId: "user_1",
      principalId: "user:user_1",
    });
  });

  it("preserves legacy project-key identity without fabricating a user", async () => {
    const fixture = build();
    fixture.resolve.mockResolvedValue({ type: "legacyProjectKey", project });

    await expect(
      fixture.service.resolve({ token: "secret", projectId: project.id }),
    ).resolves.toEqual({
      project: { id: project.id, slug: project.slug },
      userId: null,
      principalId: "legacy-project:project_1",
    });
    expect(fixture.authorize).not.toHaveBeenCalled();
  });

  it("lists only project identifiers and names after resolving an organization key", async () => {
    const fixture = build();
    fixture.resolve.mockResolvedValueOnce(null);

    await expect(
      fixture.service.resolve({ token: "secret", projectId: null }),
    ).rejects.toMatchObject({
      meta: { reason: "project_required", projects: [{ id: project.id, name: project.name }] },
    });
    expect(fixture.listProjects).toHaveBeenCalledWith({
      organizationId: "org_1",
      page: 1,
      limit: 50,
    });
  });

  it("identifies an ownerless service key separately from other credentials", async () => {
    const fixture = build();
    fixture.resolve.mockResolvedValue({ ...fixture.token, userId: null });

    await expect(
      fixture.service.resolve({ token: "secret", projectId: project.id }),
    ).resolves.toEqual({
      project: { id: project.id, slug: project.slug },
      userId: null,
      principalId: "key:key_1",
    });
  });

  // @scenario "Project discovery excludes projects outside the key bindings"
  it("does not suggest projects outside the token bindings", async () => {
    const fixture = build();
    const foreignProject = { ...project, id: "project_other", name: "Private Project" };
    fixture.listProjects.mockResolvedValue({ data: [foreignProject, project] });
    fixture.resolve.mockImplementation(async ({ projectId }: { projectId: string | null }) =>
      projectId === project.id ? fixture.token : null,
    );

    await expect(
      fixture.service.resolve({ token: "secret", projectId: null }),
    ).rejects.toMatchObject({
      meta: { reason: "project_required", projects: [{ id: project.id, name: project.name }] },
    });
    expect(fixture.resolve).toHaveBeenCalledWith({ token: "secret", projectId: foreignProject.id });
    expect(fixture.authorize).toHaveBeenCalledTimes(1);
  });

  // @scenario "Project discovery applies the key owner's effective permission"
  it("omits projects where the key owner's effective scenarios manage permission is denied", async () => {
    const fixture = build();
    fixture.resolve.mockResolvedValueOnce(null);
    fixture.authorize.mockResolvedValue(false);

    await expect(
      fixture.service.resolve({ token: "secret", projectId: null }),
    ).rejects.toMatchObject({
      meta: { reason: "project_required", projects: [] },
    });
    expect(fixture.authorize).toHaveBeenCalledWith({
      apiKeyId: "key_1",
      userId: "user_1",
      organizationId: "org_1",
      scope: { type: "project", id: project.id, teamId: project.teamId },
      permission: "scenarios:manage",
    });
  });

  // @scenario "Unsupported credentials cannot discover projects"
  it.each([{ ingestionTemplateId: "ingestion_1" }, { name: LANGY_SESSION_API_KEY_NAME }])(
    "refuses unsupported key kinds before project discovery: %j",
    async (change) => {
      const fixture = build();
      fixture.resolve.mockResolvedValue(null);
      fixture.verify.mockResolvedValue({ ...fixture.key, ...change });

      await expect(
        fixture.service.resolve({ token: "secret", projectId: null }),
      ).rejects.toMatchObject({
        meta: { reason: "key_type_not_allowed" },
      });
      expect(fixture.listProjects).not.toHaveBeenCalled();
      expect(fixture.authorize).not.toHaveBeenCalled();
    },
  );

  it.each([project.id, null])(
    "rejects an unknown token without enumerating projects: %s",
    async (projectId) => {
      const fixture = build();
      fixture.resolve.mockResolvedValue(null);
      fixture.verify.mockResolvedValue(null);

      await expect(fixture.service.resolve({ token: "secret", projectId })).rejects.toMatchObject({
        meta: { reason: "api_key_invalid" },
      });
      expect(fixture.listProjects).not.toHaveBeenCalled();
    },
  );
});
