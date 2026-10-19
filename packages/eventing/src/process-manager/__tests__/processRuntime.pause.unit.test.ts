/**
 * @vitest-environment node
 * A paused process runtime starts no outbox drain; a drain already running
 * settles, and resuming drains again. Spec: packages/eventing/specs/consumer-pause.feature
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { buildProcessManager } from "../../pipeline/processBuilder.ts";
import { testEventSchema } from "../../services/__tests__/testHelpers.ts";
import { type DispatchReport, OutboxDispatcherService } from "../outbox/outboxDispatcherService.ts";
import { ProcessRuntime } from "../processRuntime.ts";
import { InMemoryProcessStore } from "../stores/inMemoryProcessStore.ts";

const triggerSchema = testEventSchema("test.process.triggered", z.object({}));
const emptyReport: DispatchReport = {
  dispatched: [],
  retried: [],
  dead: [],
  released: [],
  fenced: [],
};
const waitOptions = { timeout: 2_000, interval: 5 };

afterEach(() => {
  vi.restoreAllMocks();
});

/** Every drain the runtime starts, each settling when the test answers it. */
function recordDrains(): ((report: DispatchReport) => void)[] {
  const drains: ((report: DispatchReport) => void)[] = [];
  vi.spyOn(OutboxDispatcherService.prototype, "runOnce").mockImplementation(
    () => new Promise<DispatchReport>((resolve) => drains.push(resolve)),
  );
  return drains;
}

function mountedRuntime({ held }: { held: boolean }): ProcessRuntime {
  const runtime = new ProcessRuntime({
    store: InMemoryProcessStore.createForTesting(),
    consumersEnabled: true,
    held,
  });
  runtime.registerPipeline({
    pipelineName: "pausing",
    processManagers: new Map([
      [
        "first",
        buildProcessManager({
          name: "first",
          applier: (pm) =>
            pm
              .state(z.object({}), {})
              .intent("noop", z.object({}), async () => {})
              .on(triggerSchema, (state) => ({ state, intents: [] })),
        }),
      ],
    ]),
  });
  return runtime;
}

describe("ProcessRuntime pause", () => {
  describe("given a running runtime with a drain in flight", () => {
    /** @scenario "A paused process runtime starts no outbox drain" */
    it("starts no drain while paused, lets the running one settle, and drains again on resume", async () => {
      const drains = recordDrains();
      const runtime = mountedRuntime({ held: false });
      await vi.waitFor(() => expect(drains).toHaveLength(1), waitOptions);

      runtime.pause();
      runtime.pause();
      runtime.notifyOutbox("first");
      drains[0]!(emptyReport);
      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(drains).toHaveLength(1);

      runtime.resume();
      runtime.resume();
      await vi.waitFor(() => expect(drains).toHaveLength(2), waitOptions);
      drains[1]!(emptyReport);
      await runtime.stop();
    });
  });

  describe("given a held runtime paused before it starts", () => {
    /** @scenario "A runtime paused before it starts stays idle when started" */
    it("drains nothing on start and drains once resumed", async () => {
      const drains = recordDrains();
      const runtime = mountedRuntime({ held: true });
      runtime.pause();

      runtime.start();
      runtime.notifyOutbox("first");
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(drains).toHaveLength(0);

      runtime.resume();
      await vi.waitFor(() => expect(drains).toHaveLength(1), waitOptions);
      drains[0]!(emptyReport);
      await runtime.stop();
    });
  });
});
