/** @vitest-environment node */

import { MemoryFeatureFlagService } from "@langwatch/feature-flag-server/testing";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createTestApp } from "~/server/app-layer/presets";
import { LWQL_FLAG, lwqlEnabled } from "../access";

describe("LangWatchQL feature access", () => {
  const featureFlags = MemoryFeatureFlagService.create();
  const app = createTestApp({ featureFlags });

  beforeEach(() => {
    vi.restoreAllMocks();
    featureFlags.setFlag(LWQL_FLAG, true);
  });

  it("evaluates the flag for the owning organization and project", async () => {
    vi.spyOn(app.projects, "getOrganizationId").mockResolvedValue("organization_1");
    const isEnabled = vi.spyOn(featureFlags, "isEnabled");

    await lwqlEnabled({
      featureFlags,
      projectId: "project_1",
      projects: app.projects,
    });

    expect(isEnabled).toHaveBeenCalledWith(LWQL_FLAG, {
      kind: "project",
      projectId: "project_1",
      organizationId: "organization_1",
    });
  });

  it("returns the composed service decision", async () => {
    vi.spyOn(app.projects, "getOrganizationId").mockResolvedValue("organization_1");
    featureFlags.setFlag(LWQL_FLAG, false);

    await expect(
      lwqlEnabled({
        featureFlags,
        projectId: "project_1",
        projects: app.projects,
      }),
    ).resolves.toBe(false);
  });
});
