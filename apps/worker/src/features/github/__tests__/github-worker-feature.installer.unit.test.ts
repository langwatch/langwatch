/**
 * Whether the worker's GitHub feature composes the sweep it claims to.
 *
 * The pipeline used to arrive built, from a registry that had already closed
 * over the App's GitHub service; it is built here now, against this graph's own
 * process store. Two things have to hold for that to be the same sweep: the
 * registered pipeline must carry the routing keys the shared queue was staged
 * with, and the intents behind its schedule must call THIS graph's sweep rather
 * than an inert stand-in. A pipeline that registers and never re-checks looks
 * identical from every health signal the fleet watches.
 *
 * Spec: packages/features/github/specs/github-branch-maintenance.feature
 */
import type { StaticPipelineDefinition } from "@langwatch/eventing";
import { GITHUB_BRANCH_RECHECK_PROCESS_NAME } from "@langwatch/github-server";
import { describe, expect, it, vi } from "vitest";

import type { WorkerEventingRuntime } from "../../../platform/eventing/worker-eventing.runtime";
import { GithubWorkerFeatureInstaller } from "../github-worker-feature.installer";

type Registered = StaticPipelineDefinition<any, any, any>;

function eventingDouble() {
  const registered: Registered[] = [];
  const deleteDispatchedBefore = vi.fn(
    async (_params: { processName: string; before: number }) => 0,
  );
  const eventing = {
    eventSourcing: { register: (definition: Registered) => void registered.push(definition) },
    processStore: { deleteDispatchedBefore },
  } as unknown as WorkerEventingRuntime;
  return { eventing, registered, deleteDispatchedBefore };
}

function sweepDouble() {
  return {
    recheckDueBranches: vi.fn(async () => 3),
    pruneStaleBranchLinkage: vi.fn(async () => ({ branchChecks: 4 })),
  };
}

/** One of the two scheduled intents, as the graph registered it. */
function intent(definition: Registered, name: "recheck" | "prune") {
  const process = definition.processManagers.get(GITHUB_BRANCH_RECHECK_PROCESS_NAME);
  expect(process, "the sweep registered no scheduled process manager").toBeDefined();
  return process!.config.intents![name]!.run;
}

async function install(branchMaintenance = sweepDouble()) {
  const { eventing, registered, deleteDispatchedBefore } = eventingDouble();
  const installer = GithubWorkerFeatureInstaller.create({ eventing, branchMaintenance });
  await installer.install();
  return { installer, registered, branchMaintenance, deleteDispatchedBefore };
}

describe("the GitHub worker feature", () => {
  describe("given a graph composed with a branch sweep", () => {
    describe("when the feature installs", () => {
      /** @scenario "The worker composes the branch sweep from the feature package" */
      it("registers the branch maintenance pipeline", async () => {
        const { registered } = await install();

        expect(registered.map((definition) => definition.metadata.name)).toEqual([
          "github_maintenance",
        ]);
      });

      /** @scenario "The worker composes the branch sweep from the feature package" */
      it("runs the composed recheck when the schedule fires", async () => {
        const { registered, branchMaintenance } = await install();

        await intent(registered[0]!, "recheck")({ scheduledFor: 0 } as never, {} as never);

        expect(branchMaintenance.recheckDueBranches).toHaveBeenCalledTimes(1);
      });

      /** @scenario "The worker composes the branch sweep from the feature package" */
      it("runs the composed prune when the daily wake fires", async () => {
        const { registered, branchMaintenance } = await install();

        await intent(registered[0]!, "prune")({ scheduledFor: 0 } as never, {} as never);

        expect(branchMaintenance.pruneStaleBranchLinkage).toHaveBeenCalledTimes(1);
      });

      /**
       * The outbox rows the recheck writes are pruned by the same graph that
       * wrote them. Built against another process store, this sweep would prune
       * another process's bookkeeping and leave its own to grow.
       *
       * @scenario "The worker composes the branch sweep from the feature package"
       */
      it("prunes its own outbox through this graph's process store", async () => {
        const { registered, deleteDispatchedBefore } = await install();

        await intent(registered[0]!, "prune")({ scheduledFor: 0 } as never, {} as never);

        expect(deleteDispatchedBefore).toHaveBeenCalledTimes(1);
        expect(deleteDispatchedBefore.mock.calls[0]![0]).toMatchObject({
          processName: GITHUB_BRANCH_RECHECK_PROCESS_NAME,
        });
      });
    });

    describe("when the feature installs twice", () => {
      it("registers the pipeline once", async () => {
        const { installer, registered } = await install();

        await installer.install();

        expect(registered).toHaveLength(1);
      });
    });
  });
});
