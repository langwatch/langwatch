/**
 * The app authorizes the exact tenant target it was asked for, takes the
 * caller's identity from the session the transport authenticated rather than
 * from the request body, and keeps tenant policy out of a viewer's catalogue.
 */
import { PermissionDeniedError } from "@langwatch/authz-contract";
import type { AuthzApi } from "@langwatch/authz-contract";
import type { OrganizationApi } from "@langwatch/organization-contract";
import type { ProjectApi } from "@langwatch/project-contract";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { FeatureFlagService } from "../../services/feature-flag.service.ts";
import { createFeatureFlagTestApp } from "./feature-flag.fixture.ts";

const USER_ID = "user_1";
const PROJECT_ID = "project_1";
const ORGANIZATION_ID = "organization_1";
const FLAG = "release_ui_ai_governance_enabled";

type PermissionCheck = {
  userId: string;
  permission: string;
  projectId?: string;
  organizationId?: string;
};

function buildApp() {
  const hasPermission = vi.fn(async (_check: PermissionCheck): Promise<boolean> => true);
  const getOrganizationId = vi.fn(async (_projectId: string): Promise<string> => ORGANIZATION_ID);
  const memberOrganizationIds = vi.fn(
    async (input: { userId: string; organizationIds: string[] }): Promise<string[]> =>
      input.organizationIds,
  );
  const app = createFeatureFlagTestApp({
    dependencies: {
      permissions: createApiFixture<AuthzApi>({ hasPermission }),
      projects: createApiFixture<ProjectApi>({ getOrganizationId }),
      organizations: createApiFixture<OrganizationApi>({ memberOrganizationIds }),
    },
  });

  return { app, hasPermission, getOrganizationId };
}

describe("featureFlag target authorization", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  /** @scenario "A project cannot be paired with another organization" */
  it("rejects an organization target the caller cannot view", async () => {
    const { app, hasPermission } = buildApp();
    hasPermission.mockResolvedValue(false);
    const isEnabled = vi.spyOn(FeatureFlagService.prototype, "isEnabled");

    await expect(
      app.isEnabledForCaller({ flag: FLAG, organizationId: ORGANIZATION_ID, userId: USER_ID }),
    ).rejects.toBeInstanceOf(PermissionDeniedError);
    expect(isEnabled).not.toHaveBeenCalled();
  });

  /** @scenario "A project cannot be paired with another organization" */
  it("rejects a project paired with a different organization", async () => {
    const { app, getOrganizationId } = buildApp();
    getOrganizationId.mockResolvedValue("organization_2");
    const isEnabled = vi.spyOn(FeatureFlagService.prototype, "isEnabled");

    await expect(
      app.isEnabledForCaller({
        flag: FLAG,
        projectId: PROJECT_ID,
        organizationId: ORGANIZATION_ID,
        userId: USER_ID,
      }),
    ).rejects.toBeInstanceOf(PermissionDeniedError);
    expect(isEnabled).not.toHaveBeenCalled();
  });

  /** @scenario "A project cannot be paired with another organization" */
  it("rejects a named project target paired with a different organization", async () => {
    const { app, getOrganizationId } = buildApp();
    getOrganizationId.mockResolvedValue("organization_2");
    const resolveFrontendFlags = vi.spyOn(FeatureFlagService.prototype, "resolveFrontendFlags");

    await expect(
      app.resolveFrontendFlagsForCaller({
        userId: USER_ID,
        target: {
          kind: "project",
          projectId: PROJECT_ID,
          organizationId: ORGANIZATION_ID,
        },
      }),
    ).rejects.toBeInstanceOf(PermissionDeniedError);
    expect(resolveFrontendFlags).not.toHaveBeenCalled();
  });

  it("evaluates an authorized organization as that organization's target", async () => {
    const { app } = buildApp();
    const isEnabled = vi.spyOn(FeatureFlagService.prototype, "isEnabled").mockResolvedValue(true);

    await expect(
      app.isEnabledForCaller({
        flag: FLAG,
        organizationId: ORGANIZATION_ID,
        userId: USER_ID,
      }),
    ).resolves.toBe(true);
    expect(isEnabled).toHaveBeenCalledWith(FLAG, {
      kind: "organization",
      userId: USER_ID,
      organizationId: ORGANIZATION_ID,
    });
  });

  /** @scenario "Target rule context is derived from one canonical target" */
  it("derives a project's organization and buckets the rollout by the authenticated user", async () => {
    const { app } = buildApp();
    const isEnabled = vi.spyOn(FeatureFlagService.prototype, "isEnabled").mockResolvedValue(true);

    await expect(
      app.isEnabledForCaller({ flag: FLAG, projectId: PROJECT_ID, userId: USER_ID }),
    ).resolves.toBe(true);

    expect(isEnabled).toHaveBeenCalledWith(FLAG, {
      kind: "project",
      userId: USER_ID,
      projectId: PROJECT_ID,
      organizationId: ORGANIZATION_ID,
    });
  });

  /** @scenario "A viewer cannot read tenant experiment policy" */
  it("does not expose tenant policy fields to a viewer", async () => {
    const { app, hasPermission } = buildApp();
    hasPermission.mockResolvedValueOnce(true).mockResolvedValue(false);
    vi.spyOn(FeatureFlagService.prototype, "resolveExperimentCatalogue").mockResolvedValue([
      {
        key: FLAG,
        title: "Preview",
        summary: "A preview",
        catalogueVersion: 1,
        enabled: false,
        decision: "tenant-disabled",
        userEnrolled: false,
        projectPolicy: "disabled",
        organizationPolicy: "enabled",
      },
    ]);

    const experiments = await app.listExperimentsForCaller({
      userId: USER_ID,
      target: {
        kind: "project",
        projectId: PROJECT_ID,
        organizationId: ORGANIZATION_ID,
      },
    });

    expect(experiments[0]).not.toHaveProperty("projectPolicy");
    expect(experiments[0]).not.toHaveProperty("organizationPolicy");
  });

  /** @scenario "Setting a project policy requires the manage permission on that project" */
  it("refuses to set a project policy without the manage permission on that project", async () => {
    const { app, hasPermission } = buildApp();
    hasPermission.mockResolvedValue(false);
    const setExperimentTenantPolicy = vi.spyOn(
      FeatureFlagService.prototype,
      "setExperimentTenantPolicy",
    );

    await expect(
      app.setExperimentTenantPolicyForCaller({
        flag: FLAG,
        scope: { kind: "project", projectId: PROJECT_ID },
        policy: "disabled",
        userId: USER_ID,
      }),
    ).rejects.toBeInstanceOf(PermissionDeniedError);
    expect(setExperimentTenantPolicy).not.toHaveBeenCalled();
  });

  /** @scenario "Target rule context is derived from one canonical target" */
  it("passes the exact authorized project target to evaluation and experiment reads", async () => {
    const { app } = buildApp();
    const resolveFrontendFlags = vi
      .spyOn(FeatureFlagService.prototype, "resolveFrontendFlags")
      .mockResolvedValue({} as never);
    const resolveExperimentCatalogue = vi
      .spyOn(FeatureFlagService.prototype, "resolveExperimentCatalogue")
      .mockResolvedValue([]);
    const target = {
      kind: "project" as const,
      projectId: PROJECT_ID,
      organizationId: ORGANIZATION_ID,
    };

    await app.resolveFrontendFlagsForCaller({ target, userId: USER_ID });
    await expect(app.listExperimentsForCaller({ target, userId: USER_ID })).resolves.toEqual([]);

    const authorizedTarget = {
      kind: "project" as const,
      userId: USER_ID,
      projectId: PROJECT_ID,
      organizationId: ORGANIZATION_ID,
    };
    expect(resolveFrontendFlags).toHaveBeenCalledWith(authorizedTarget);
    expect(resolveExperimentCatalogue).toHaveBeenCalledWith(authorizedTarget);
  });

  it("stamps the authorized target and caller onto experiment writes", async () => {
    const { app } = buildApp();
    const setUserExperimentEnrolment = vi
      .spyOn(FeatureFlagService.prototype, "setUserExperimentEnrolment")
      .mockResolvedValue();
    const setExperimentTenantPolicy = vi
      .spyOn(FeatureFlagService.prototype, "setExperimentTenantPolicy")
      .mockResolvedValue();
    const target = {
      kind: "project" as const,
      projectId: PROJECT_ID,
      organizationId: ORGANIZATION_ID,
    };

    await app.setExperimentEnrolmentForCaller({
      flag: FLAG,
      target,
      enrolled: true,
      userId: USER_ID,
    });
    await app.setExperimentTenantPolicyForCaller({
      flag: FLAG,
      scope: { kind: "project", projectId: PROJECT_ID },
      policy: "enabled",
      userId: USER_ID,
    });

    expect(setUserExperimentEnrolment).toHaveBeenCalledWith({
      flagKey: FLAG,
      target: {
        kind: "project",
        userId: USER_ID,
        projectId: PROJECT_ID,
        organizationId: ORGANIZATION_ID,
      },
      enrolled: true,
    });
    expect(setExperimentTenantPolicy).toHaveBeenCalledWith({
      flagKey: FLAG,
      scope: { kind: "project", projectId: PROJECT_ID },
      policy: "enabled",
      changedByUserId: USER_ID,
    });
  });
});
