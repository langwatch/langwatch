/**
 * Whether the worker's Langy maintenance feature composes the sweep it claims to.
 *
 * The pipeline used to arrive built, from a registry that had already closed
 * over the App's session-key service; it is built here now, from the feature
 * package's own maintenance adapter. Two things have to hold for that to be the
 * same sweep: the registered pipeline must still carry the routing keys the
 * shared queue was staged with, and the intent behind its schedule must call
 * THIS graph's revoke rather than an inert stand-in. A pipeline that registers
 * and never revokes looks identical from every health signal the fleet watches.
 *
 * Spec: packages/features/langy/specs/langy-session-key-maintenance.feature
 */
import type { StaticPipelineDefinition } from "@langwatch/eventing";
import { LANGY_SESSION_KEY_REAP_PROCESS_NAME } from "@langwatch/langy-server";
import { describe, expect, it, vi } from "vitest";

import type { WorkerEventingRuntime } from "../../../platform/eventing/worker-eventing.runtime";
import { LangyMaintenanceWorkerFeatureInstaller } from "../langy-maintenance-worker-feature.installer";

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

/** The scheduled intent the process manager runs, as the graph registered it. */
function reapIntent(definition: Registered) {
  const process = definition.processManagers.get(LANGY_SESSION_KEY_REAP_PROCESS_NAME);
  expect(process, "the sweep registered no scheduled process manager").toBeDefined();
  return process!.config.intents!.reap!.run;
}

describe("the Langy maintenance worker feature", () => {
  describe("given a graph composed with a session-key sweep", () => {
    describe("when the feature installs", () => {
      /** @scenario "The worker composes the session-key sweep from the feature package" */
      it("registers the Langy maintenance pipeline", async () => {
        const { eventing, registered } = eventingDouble();

        await LangyMaintenanceWorkerFeatureInstaller.create({
          eventing,
          sessionKeyReap: { reap: async () => 0 },
        }).install();

        expect(registered.map((definition) => definition.metadata.name)).toEqual([
          "langy_maintenance",
        ]);
      });

      /** @scenario "The worker composes the session-key sweep from the feature package" */
      it("runs the composed revoke when the schedule fires", async () => {
        const { eventing, registered } = eventingDouble();
        const reap = vi.fn(async () => 2);

        await LangyMaintenanceWorkerFeatureInstaller.create({
          eventing,
          sessionKeyReap: { reap },
        }).install();
        await reapIntent(registered[0]!)({ scheduledFor: 0 } as never, {} as never);

        expect(reap).toHaveBeenCalledTimes(1);
      });

      /**
       * The outbox rows the reap writes are pruned by the same graph that wrote
       * them. Built against another process store, this sweep would prune
       * another process's bookkeeping and leave its own to grow.
       */
      it("prunes its own outbox through this graph's process store", async () => {
        const { eventing, registered, deleteDispatchedBefore } = eventingDouble();

        await LangyMaintenanceWorkerFeatureInstaller.create({
          eventing,
          sessionKeyReap: { reap: async () => 0 },
        }).install();
        await reapIntent(registered[0]!)({ scheduledFor: 0 } as never, {} as never);

        expect(deleteDispatchedBefore).toHaveBeenCalledTimes(1);
        expect(deleteDispatchedBefore.mock.calls[0]![0]).toMatchObject({
          processName: LANGY_SESSION_KEY_REAP_PROCESS_NAME,
        });
      });
    });

    describe("when the feature installs twice", () => {
      it("registers the pipeline once", async () => {
        const { eventing, registered } = eventingDouble();
        const installer = LangyMaintenanceWorkerFeatureInstaller.create({
          eventing,
          sessionKeyReap: { reap: async () => 0 },
        });

        await installer.install();
        await installer.install();

        expect(registered).toHaveLength(1);
      });
    });
  });
});
