/**
 * The authenticated transport authorizes the exact tenant target it was
 * asked for, derives the caller's identity from the session rather than the
 * request body, and keeps tenant policy out of a viewer's catalogue.
 */
import type { AuthzService } from "@langwatch/authz-contract";
import { TrpcRootDefinition } from "@langwatch/api/trpc";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { FeatureFlagTrpcApi, type FeatureFlagTrpcContext } from "../feature-flag.api";
import { MemoryFeatureFlagService } from "../../../testing";

const USER_ID = "user_1";
const PROJECT_ID = "project_1";
const ORGANIZATION_ID = "organization_1";
const FLAG = "release_ui_ai_governance_enabled";

const trpc = TrpcRootDefinition.forContext<FeatureFlagTrpcContext>().create({});
const featureFlagRouter = FeatureFlagTrpcApi.create(trpc);

type PermissionCheck = {
  userId: string;
  permission: string;
  projectId?: string;
  organizationId?: string;
};

function buildCaller() {
  const featureFlags = MemoryFeatureFlagService.create();
  featureFlags.setFlag(FLAG, true);
  const hasPermission = vi.fn(async (_check: PermissionCheck): Promise<boolean> => true);
  const getOrganizationId = vi.fn(async (_projectId: string): Promise<string> => ORGANIZATION_ID);
  const memberOrganizationIds = vi.fn(
    async (input: { userId: string; organizationIds: string[] }): Promise<string[]> =>
      input.organizationIds,
  );
  const permissions: Pick<AuthzService, "hasPermission"> = { hasPermission };
  const context: FeatureFlagTrpcContext = {
    app: {
      featureFlags,
      permissions,
      projects: { getOrganizationId },
      organizations: { memberOrganizationIds },
    },
    actor: () => ({ id: USER_ID }),
  };

  return {
    caller: featureFlagRouter.createCaller(context),
    featureFlags,
    getOrganizationId,
    hasPermission,
  };
}

describe("featureFlag target authorization", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  /** @scenario "A project cannot be paired with another organization" */
  it("rejects an organization target the caller cannot view", async () => {
    const { caller, featureFlags, hasPermission } = buildCaller();
    hasPermission.mockResolvedValue(false);
    const isEnabled = vi.spyOn(featureFlags, "isEnabled");

    await expect(
      caller.isEnabled({ flag: FLAG, organizationId: ORGANIZATION_ID }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(isEnabled).not.toHaveBeenCalled();
  });

  /** @scenario "A project cannot be paired with another organization" */
  it("rejects a project paired with a different organization", async () => {
    const { caller, featureFlags, getOrganizationId } = buildCaller();
    getOrganizationId.mockResolvedValue("organization_2");
    const isEnabled = vi.spyOn(featureFlags, "isEnabled");

    await expect(
      caller.isEnabled({
        flag: FLAG,
        projectId: PROJECT_ID,
        organizationId: ORGANIZATION_ID,
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(isEnabled).not.toHaveBeenCalled();
  });

  it("preserves the legacy response while evaluating an authorized organization", async () => {
    const { caller, featureFlags } = buildCaller();
    const isEnabled = vi.spyOn(featureFlags, "isEnabled");

    await expect(
      caller.isEnabled({
        flag: FLAG,
        organizationId: ORGANIZATION_ID,
      }),
    ).resolves.toEqual({ enabled: true });
    expect(isEnabled).toHaveBeenCalledWith(FLAG, {
      kind: "organization",
      userId: USER_ID,
      organizationId: ORGANIZATION_ID,
    });
  });

  /** @scenario "Target rule context is derived from one canonical target" */
  it("derives a project's organization and buckets the rollout by the authenticated user", async () => {
    const { caller, featureFlags } = buildCaller();
    const isEnabled = vi.spyOn(featureFlags, "isEnabled");

    await expect(caller.isEnabled({ flag: FLAG, projectId: PROJECT_ID })).resolves.toEqual({
      enabled: true,
    });

    expect(isEnabled).toHaveBeenCalledWith(FLAG, {
      kind: "project",
      userId: USER_ID,
      projectId: PROJECT_ID,
      organizationId: ORGANIZATION_ID,
    });
  });

  it("does not expose tenant policy fields to a viewer", async () => {
    const { caller, featureFlags, hasPermission } = buildCaller();
    hasPermission.mockResolvedValueOnce(true).mockResolvedValue(false);
    vi.spyOn(featureFlags, "resolveExperimentCatalogue").mockResolvedValue([
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

    const result = await caller.experiments({
      target: {
        kind: "project",
        projectId: PROJECT_ID,
        organizationId: ORGANIZATION_ID,
      },
    });

    expect(result.experiments[0]).not.toHaveProperty("projectPolicy");
    expect(result.experiments[0]).not.toHaveProperty("organizationPolicy");
  });

  /** @scenario "Target rule context is derived from one canonical target" */
  it("passes the exact authorized project target to evaluation and experiment reads", async () => {
    const { caller, featureFlags } = buildCaller();
    const resolveFrontendFlags = vi.spyOn(featureFlags, "resolveFrontendFlags");
    const resolveExperimentCatalogue = vi.spyOn(featureFlags, "resolveExperimentCatalogue");
    const target = {
      kind: "project" as const,
      projectId: PROJECT_ID,
      organizationId: ORGANIZATION_ID,
    };

    await expect(caller.resolve({ target })).resolves.toMatchObject({ flags: expect.any(Object) });
    await expect(caller.experiments({ target })).resolves.toEqual({ experiments: [] });

    const authenticatedTarget = {
      kind: "project" as const,
      userId: USER_ID,
      projectId: PROJECT_ID,
      organizationId: ORGANIZATION_ID,
    };
    expect(resolveFrontendFlags).toHaveBeenCalledWith(authenticatedTarget);
    expect(resolveExperimentCatalogue).toHaveBeenCalledWith(authenticatedTarget);
  });

  it("stamps the authenticated target and actor onto experiment writes", async () => {
    const { caller, featureFlags } = buildCaller();
    const setUserExperimentEnrolment = vi.spyOn(featureFlags, "setUserExperimentEnrolment");
    const setExperimentTenantPolicy = vi.spyOn(featureFlags, "setExperimentTenantPolicy");
    const target = {
      kind: "project" as const,
      projectId: PROJECT_ID,
      organizationId: ORGANIZATION_ID,
    };

    await expect(
      caller.setExperimentEnrolment({ flag: FLAG, target, enrolled: true }),
    ).resolves.toEqual({ ok: true });
    await expect(
      caller.setExperimentTenantPolicy({
        flag: FLAG,
        scope: { kind: "project", projectId: PROJECT_ID },
        policy: "enabled",
      }),
    ).resolves.toEqual({ ok: true });

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
