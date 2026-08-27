/** @vitest-environment node */

import { MemoryFeatureFlagService } from "@langwatch/feature-flag-server/testing";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createTestApp } from "~/server/app-layer/presets";
import { createInnerTRPCContext } from "../../trpc";
import { featureFlagRouter } from "../featureFlag";

const USER_ID = "user_1";
const PROJECT_ID = "project_1";
const ORGANIZATION_ID = "organization_1";
const FLAG = "release_ui_ai_governance_enabled";

function buildCaller() {
  const featureFlags = MemoryFeatureFlagService.create();
  featureFlags.setFlag(FLAG, true);
  const app = createTestApp({ featureFlags });
  const context = createInnerTRPCContext({
    app,
    session: { user: { id: USER_ID }, expires: "1" },
    permissionChecked: true,
    publiclyShared: false,
  });

  return {
    app,
    caller: featureFlagRouter.createCaller(context),
    featureFlags,
  };
}

describe("featureFlag target authorization", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("rejects an organization target the caller cannot view", async () => {
    const { app, caller, featureFlags } = buildCaller();
    vi.spyOn(app.permissions, "hasPermission").mockResolvedValue(false);
    const isEnabled = vi.spyOn(featureFlags, "isEnabled");

    await expect(
      caller.isEnabled({ flag: FLAG, organizationId: ORGANIZATION_ID }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(isEnabled).not.toHaveBeenCalled();
  });

  it("rejects a project paired with a different organization", async () => {
    const { app, caller, featureFlags } = buildCaller();
    vi.spyOn(app.permissions, "hasPermission").mockResolvedValue(true);
    vi.spyOn(app.projects, "getOrganizationId").mockResolvedValue("organization_2");
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
    const { app, caller, featureFlags } = buildCaller();
    vi.spyOn(app.permissions, "hasPermission").mockResolvedValue(true);
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

  it("derives a project's organization and buckets the rollout by the authenticated user", async () => {
    const { app, caller, featureFlags } = buildCaller();
    vi.spyOn(app.permissions, "hasPermission").mockResolvedValue(true);
    vi.spyOn(app.projects, "getOrganizationId").mockResolvedValue(ORGANIZATION_ID);
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
    const { app, caller, featureFlags } = buildCaller();
    vi.spyOn(app.permissions, "hasPermission").mockResolvedValueOnce(true).mockResolvedValue(false);
    vi.spyOn(app.projects, "getOrganizationId").mockResolvedValue(ORGANIZATION_ID);
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

  it("passes the exact authorized project target to evaluation and experiment reads", async () => {
    const { app, caller, featureFlags } = buildCaller();
    vi.spyOn(app.permissions, "hasPermission").mockResolvedValue(true);
    vi.spyOn(app.projects, "getOrganizationId").mockResolvedValue(ORGANIZATION_ID);
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
    const { app, caller, featureFlags } = buildCaller();
    vi.spyOn(app.permissions, "hasPermission").mockResolvedValue(true);
    vi.spyOn(app.projects, "getOrganizationId").mockResolvedValue(ORGANIZATION_ID);
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
