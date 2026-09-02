/**
 * Spec: specs/server/api-process-eventing.feature
 */
import {
  createTenantId,
  defineAggregate,
  defineEvents,
  definePipeline,
  type Event,
} from "@langwatch/eventing";
import type { GroupQueueDependencies } from "@langwatch/group-queue";
import { ResourceScope } from "@langwatch/runtime-composition";
import { describe, expect, it } from "vitest";
import {
  ApiEventingAbsenceReportPort,
  ApiEventingInfrastructure,
} from "../api-eventing.infrastructure";

function stubQueue(): { dependencies: GroupQueueDependencies<Record<string, unknown>> } {
  const redis = new Proxy({}, { get: () => async () => 0 });
  return { dependencies: { redis: redis as never } };
}

class RecordingAbsence extends ApiEventingAbsenceReportPort {
  calls = 0;

  absent(): void {
    this.calls += 1;
  }
}

function processPipeline() {
  return definePipeline<Event>({
    name: "api-process-manager-pipeline",
    aggregate: defineAggregate({ type: "trace", events: defineEvents(["test.event"] as const) }),
  })
    .withProcessManager("durable-process", (process) =>
      process
        .state({ handled: 0 })
        .keyBy(() => "one")
        .on("test.event", (state) => ({ state: { handled: state.handled + 1 } })),
    )
    .build();
}

describe("ApiEventingInfrastructure", () => {
  describe("when the process has no Group Queue", () => {
    /** @scenario "A process with no queue composes no dispatch" */
    it("composes no runtime and names the consequence rather than the cause", () => {
      const report = new RecordingAbsence();

      const composed = ApiEventingInfrastructure.tryCreate({
        resources: new ResourceScope(),
        queue: undefined,
        processName: "langwatch-api-test",
        report,
      });

      expect(composed).toBeUndefined();
      expect(report.calls).toBe(1);
    });
  });

  describe("when the process has its own Group Queue", () => {
    /** @scenario "The API process's Eventing runtime owns no event log" */
    it("composes a runtime with no event log to append to", async () => {
      const composed = ApiEventingInfrastructure.create({
        resources: new ResourceScope(),
        queue: stubQueue(),
        processName: "langwatch-api-test",
      });

      const store = composed.eventSourcing.eventStore;
      if (!store) throw new Error("The API Eventing runtime composed no event store at all.");

      await expect(
        store.storeEvents([], { tenantId: createTenantId("organization-1") }, "trace"),
      ).rejects.toThrow(/langwatch-api-test/);
    });

    /** @scenario "The API process's Eventing runtime runs no process managers" */
    it("registers the pipeline and declines the process manager it could not drain", () => {
      const composed = ApiEventingInfrastructure.create({
        resources: new ResourceScope(),
        queue: stubQueue(),
        processName: "langwatch-api-test",
      });

      const registered = composed.eventSourcing.register(processPipeline());

      // Registering the pipeline is the whole point: refusing it took every
      // COMMAND on the definition down with the one process manager, and a
      // customer's action is a command.
      expect(registered.name).toBe("api-process-manager-pipeline");
      expect(composed.eventSourcing.unrunProcessManagers).toEqual(["durable-process"]);
      expect(() => composed.eventSourcing.processRuntime).toThrow(/producer-only/);
    });

    /** @scenario "The runtime is released before the connection under it" */
    it("is owned by the resource scope, and closes once", async () => {
      const resources = new ResourceScope();
      const composed = ApiEventingInfrastructure.create({
        resources,
        queue: stubQueue(),
        processName: "langwatch-api-test",
      });

      await composed.close();
      await expect(resources.close()).resolves.toBeUndefined();
    });
  });
});
