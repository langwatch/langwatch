/** @vitest-environment node */

import { createApiFixture } from "@langwatch/api-fixture";
import type { FeatureFlagApi } from "@langwatch/feature-flag-contract";
import type { ProjectApi } from "@langwatch/project-contract";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { LWQL_FLAG, lwqlEnabled } from "../../rules/lwql-access.rules.ts";

/**
 * `lwqlEnabled` takes the project service as a parameter, so the gate can be asked in isolation --
 * it used to go through `createTestApp().projects` with `vi.spyOn`, which broke once the service
 * was wrapped for tracing, since `spyOn` cannot replace a method reached through a proxy.
 */
function projectsIn(organizationId: string): ProjectApi {
  return createApiFixture<ProjectApi>(
    { getOrganizationId: async () => organizationId },
    "lwql projects",
  );
}

/** One flag, answered; every other operation refuses by name. */
function flagsSaying(on: { value: boolean }): {
  featureFlags: FeatureFlagApi;
  isEnabled: ReturnType<typeof vi.fn>;
} {
  const isEnabled = vi.fn(async () => on.value);
  return { featureFlags: createApiFixture<FeatureFlagApi>({ isEnabled }, "lwql flags"), isEnabled };
}

describe("LangWatchQL feature access", () => {
  const on = { value: true };
  let featureFlags: FeatureFlagApi;
  let isEnabled: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.restoreAllMocks();
    on.value = true;
    ({ featureFlags, isEnabled } = flagsSaying(on));
  });

  describe("given a project belonging to an organization", () => {
    describe("when the gate is asked", () => {
      /** @scenario "The switch is decided for the project's organization, not for the project alone" */
      it("evaluates the flag for both the project and its organization", async () => {
        await lwqlEnabled({
          featureFlags,
          projectId: "project_1",
          projects: projectsIn("organization_1"),
        });

        expect(isEnabled).toHaveBeenCalledWith(LWQL_FLAG, {
          kind: "project",
          projectId: "project_1",
          organizationId: "organization_1",
        });
      });
    });
  });

  describe("given the flag is off", () => {
    describe("when the gate is asked", () => {
      it("returns the flag service's decision", async () => {
        on.value = false;

        await expect(
          lwqlEnabled({
            featureFlags,
            projectId: "project_1",
            projects: projectsIn("organization_1"),
          }),
        ).resolves.toBe(false);
      });
    });
  });

  describe("given the flag is on", () => {
    describe("when the gate is asked", () => {
      it("returns the flag service's decision", async () => {
        await expect(
          lwqlEnabled({
            featureFlags,
            projectId: "project_1",
            projects: projectsIn("organization_1"),
          }),
        ).resolves.toBe(true);
      });
    });
  });

  describe("given a rule granting the switch to one organization only", () => {
    const grantedTo = "organization_1";
    const ruleFlags = () =>
      createApiFixture<FeatureFlagApi>(
        {
          isEnabled: async (_flag, context) =>
            context.kind === "project" && context.organizationId === grantedTo,
        },
        "lwql organization rule",
      );
    const ask = (input: { projectId: string; organizationId: string }) =>
      lwqlEnabled({
        featureFlags: ruleFlags(),
        projectId: input.projectId,
        projects: projectsIn(input.organizationId),
      });

    /** @scenario "The API's switch is decided for the project's organization" */
    it("answers for the project of the granted organization and refuses one outside it", async () => {
      expect(await ask({ projectId: "project_1", organizationId: grantedTo })).toBe(true);
      expect(await ask({ projectId: "project_2", organizationId: "organization_2" })).toBe(false);
    });

    /** @scenario "An organization-scoped rule can switch the chart surfaces on" */
    it("is on for a project in that organization and off for a project outside it", async () => {
      expect(await ask({ projectId: "project_3", organizationId: grantedTo })).toBe(true);
      expect(await ask({ projectId: "project_3", organizationId: "organization_9" })).toBe(false);
    });
  });
});
