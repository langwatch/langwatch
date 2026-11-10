/**
 * @vitest-environment node
 * @see specs/langy/langy-model-allowlist.feature
 */
import type { AuthzApi } from "@langwatch/authz-contract";
import type { FeatureFlagApi } from "@langwatch/feature-flag-contract";
import { langySetModelsAllowedInputSchema } from "@langwatch/langy-contract";
import type { ProjectApi } from "@langwatch/project-contract";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { describe, expect, it, vi } from "vitest";

import type { LangyService } from "../../../../services/langy.service.ts";
import { LangyPanelAccessService } from "../langy-panel-access.service.ts";
import { LangyPanelModelsService } from "../langy-panel-models.service.ts";

const caller = { userId: "user_1", name: "Ada", email: "ada@example.com" };
const projectId = "project_1";

function models({ demo = false } = {}) {
  const setModelsAllowedForProject = vi.fn(async () => ["openai/gpt-5"]);
  const service = LangyPanelModelsService.create({
    access: LangyPanelAccessService.create({
      featureFlags: createApiFixture<FeatureFlagApi>({ isEnabled: async () => true }),
      projects: createApiFixture<ProjectApi>({ getOrganizationId: async () => "org_1" }),
      authz: createApiFixture<AuthzApi>({ isDemoProject: () => demo }),
    }),
    langy: createApiFixture<
      Pick<LangyService, "findModelsAllowedForProject" | "setModelsAllowedForProject">
    >({ setModelsAllowedForProject, findModelsAllowedForProject: async () => null }),
  });
  return { service, setModelsAllowedForProject };
}

describe("LangyPanelModelsService", () => {
  describe("when a project admin saves the list", () => {
    it("saves it on the caller's behalf and answers the list read back", async () => {
      const { service, setModelsAllowedForProject } = models();

      await expect(
        service.setModelsAllowed({ caller, projectId, modelsAllowed: ["openai/gpt-5"] }),
      ).resolves.toEqual({ modelsAllowed: ["openai/gpt-5"] });
      expect(setModelsAllowedForProject).toHaveBeenCalledWith({
        projectId,
        actorUserId: "user_1",
        modelsAllowed: ["openai/gpt-5"],
      });
    });
  });

  describe("given the demo project", () => {
    /** @scenario "The demo project refuses the Langy model list" */
    it("refuses the save as Langy not enabled, writing nothing", async () => {
      const { service, setModelsAllowedForProject } = models({ demo: true });

      await expect(
        service.setModelsAllowed({ caller, projectId, modelsAllowed: ["openai/gpt-5"] }),
      ).rejects.toMatchObject({ code: "langy_not_enabled" });
      expect(setModelsAllowedForProject).not.toHaveBeenCalled();
    });
  });

  describe("when a model reference names no provider", () => {
    /** @scenario "A model reference without a provider is refused" */
    it("is refused at the wire, before any save", () => {
      expect(
        langySetModelsAllowedInputSchema.validate({ projectId, modelsAllowed: ["gpt-5"] }),
      ).toBe(false);
      expect(
        langySetModelsAllowedInputSchema.parse({ projectId, modelsAllowed: [" openai/gpt-5 "] }),
      ).toEqual({ projectId, modelsAllowed: ["openai/gpt-5"] });
    });
  });
});
