/**
 * The names this pipeline registers, pinned as literals.
 *
 * FROZEN TWIN. Two graphs register this definition today: apps/worker builds it
 * from this package, and platform/app's legacy `pipelineRegistry` builds it from
 * the same class over its own runtime. They share one `event-sourcing/jobs`
 * queue, which routes by `${pipeline}:${jobType}:${jobName}` and rejects an
 * unroutable job for redelivery rather than dropping it. A name changed on one
 * side is therefore not a rename — it is a second routing key that only one
 * consumer stages, and the work behind it simply stops. These literals may only
 * change in a commit that changes the twin too.
 *
 * Spec: packages/features/github/specs/github-branch-maintenance.feature
 */
import { describe, expect, it, vi } from "vitest";

import { EventingGithubMaintenanceAdapter } from "../eventing.github-maintenance.adapter";

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
