/**
 * FROZEN TWIN: pipeline name literals shared between apps/worker and
 * platform/app; queue routes by `${pipeline}:${jobType}:${jobName}`.
 */
import { describe, expect, it, vi } from "vitest";

import { EventingGithubMaintenanceAdapter } from "../github-maintenance.service.ts";

function build(
  sweep = {
    recheckDueBranches: vi.fn(async () => 0),
    pruneStaleBranchLinkage: vi.fn(async () => ({ branchChecks: 0 })),
  },
) {
  const deleteDispatchedBefore = vi.fn(async () => 0);
  const definition = EventingGithubMaintenanceAdapter.create({
    github: sweep,
    processStore: { deleteDispatchedBefore } as never,
  }).build();
  return { definition, sweep, deleteDispatchedBefore };
}

describe("the GitHub maintenance pipeline", () => {
  describe("given the definition both graphs register", () => {
    it("carries the pipeline, process and intent names the queue routes by", () => {
      const { definition } = build();
      const process = definition.processManagers.get("githubBranchRecheck");

      expect(definition.metadata.name).toBe("github_maintenance");
      expect(process, "the sweep registered no scheduled process manager").toBeDefined();
      expect(Object.keys(process!.config.intents ?? {})).toEqual(["recheck", "prune"]);
    });

    it("sweeps on the ten-minute schedule the fleet is sized for", () => {
      const { definition } = build();

      expect(definition.processManagers.get("githubBranchRecheck")!.config.schedule).toMatchObject({
        everyMs: 10 * 60 * 1000,
      });
    });
  });

  describe("given a sweep that is not the published GitHub service", () => {
    /**
     * The narrowing that lets a worker mount this at all: the definition takes
     * the two sweep operations, not the 30-method facade they used to arrive
     * inside. A plain object with both is a complete dependency.
     */
    it("builds from the two sweep operations alone", async () => {
      const { definition, sweep } = build();
      const intents = definition.processManagers.get("githubBranchRecheck")!.config.intents!;

      await intents.recheck!.run({ scheduledFor: 0 } as never, {} as never);
      await intents.prune!.run({ scheduledFor: 0 } as never, {} as never);

      expect(sweep.recheckDueBranches).toHaveBeenCalledTimes(1);
      expect(sweep.pruneStaleBranchLinkage).toHaveBeenCalledTimes(1);
    });
  });
});
