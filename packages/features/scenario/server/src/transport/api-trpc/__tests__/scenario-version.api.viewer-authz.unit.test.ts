/**
 * @vitest-environment node
 * @see specs/scenarios/scenario-versioning.feature
 * @see specs/scenarios/scenario-version-restore.feature
 */

// Version history is readable at `scenarios:view` and writable only at
// `scenarios:manage`, so a viewer sees the whole history and is refused
// every write against it.

import { initTRPC, TRPCError } from "@trpc/server";
import { describe, expect, it, vi } from "vitest";
import type { ScenarioApp } from "#app/scenario.app";
import type { ScenarioTrpcContext } from "../../../rules/scenario-trpc-context.rules";
import { createScenarioCrudRouter } from "../scenario-crud.api";
import { createScenarioVersionRouter } from "../scenario-version.api";

/** What a read-only role holds: the view grain and nothing above it. */
const VIEWER_PERMISSIONS = new Set(["scenarios:view"]);

function viewerHarness() {
  const trpc = initTRPC.context<ScenarioTrpcContext>().create();
  const listVersions = vi.fn().mockResolvedValue({
    versions: [
      { version: 2, authorId: null, changedFields: ["situation"] },
      { version: 1, authorId: null, changedFields: [] },
    ],
    nextCursor: null,
  });
  const restoreVersion = vi.fn();
  const update = vi.fn();
  const getUserProfiles = vi.fn().mockResolvedValue([]);

  const policy = (permission: string) => (procedure: unknown) => {
    if (VIEWER_PERMISSIONS.has(permission)) return procedure as never;
    return trpc.procedure.use(async () => {
      throw new TRPCError({ code: "FORBIDDEN", message: "insufficient_permissions" });
    }) as never;
  };
  const procedures = { protected: trpc.procedure, policy } as never;

  const scenarios = {
    listVersions,
    restoreVersion,
    update,
    getUserProfiles,
  } as unknown as ScenarioApp;
  const ctx = {
    app: { scenarios },
    actor: () => ({ id: "user_viewer" }),
    signal: undefined,
  } as unknown as ScenarioTrpcContext;

  const versions = createScenarioVersionRouter(trpc, procedures).createCaller(ctx);
  const crud = createScenarioCrudRouter(trpc, procedures, {
    trackScenarioCreated: () => {},
    fireScenarioCreatedNurturing: () => {},
    captureException: () => {},
  }).createCaller(ctx);

  return { versions, crud, listVersions, restoreVersion, update };
}

describe("given a person with read-only access to the project", () => {
  describe("when they open the history of a scenario", () => {
    /** @scenario "A viewer can read version history but cannot save" */
    it("lets them read every version and refuses their save", async () => {
      const { versions, crud, update } = viewerHarness();

      const history = await versions.listVersions({
        projectId: "project_1",
        scenarioId: "scenario_1",
      });
      expect(history.versions.map((version) => version.version)).toEqual([2, 1]);

      await expect(
        crud.update({
          projectId: "project_1",
          id: "scenario_1",
          situation: "A viewer's save",
        }),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
      expect(update).not.toHaveBeenCalled();
    });
  });

  describe("when they try to restore a version", () => {
    /** @scenario "A viewer cannot restore a version" */
    it("refuses the restore and leaves the scenario unchanged", async () => {
      const { versions, restoreVersion } = viewerHarness();

      await expect(
        versions.restoreVersion({
          projectId: "project_1",
          scenarioId: "scenario_1",
          version: 1,
        }),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
      expect(restoreVersion).not.toHaveBeenCalled();
    });
  });
});
