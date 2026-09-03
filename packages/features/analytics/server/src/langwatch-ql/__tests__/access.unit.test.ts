/** @vitest-environment node */

import { MemoryFeatureFlagService } from "@langwatch/feature-flag-server/testing";
import type { ProjectService } from "@langwatch/project-contract";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { LWQL_FLAG, lwqlEnabled } from "../access";

/**
 * `lwqlEnabled` takes the project service as a parameter, so the gate can be
 * asked in isolation. It used to be asked through `createTestApp().projects`
 * with `vi.spyOn`, which needed a Prisma connection to build an app it then
 * stubbed — and stopped working entirely once the composed service was wrapped
 * for tracing, since `spyOn` cannot replace a method reached through a proxy.
 */
function projectsIn(organizationId: string): ProjectService {
  return {
    getOrganizationId: vi.fn(async () => organizationId),
  } as unknown as ProjectService;
}

describe("LangWatchQL feature access", () => {
  const featureFlags = MemoryFeatureFlagService.create();

  beforeEach(() => {
    vi.restoreAllMocks();
    featureFlags.setFlag(LWQL_FLAG, true);
  });

  describe("given a project belonging to an organization", () => {
    describe("when the gate is asked", () => {
      it("evaluates the flag for both the project and its organization", async () => {
        const isEnabled = vi.spyOn(featureFlags, "isEnabled");

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
        featureFlags.setFlag(LWQL_FLAG, false);

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
});
