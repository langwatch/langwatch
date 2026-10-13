/**
 * @vitest-environment node
 * The runtime's `notifyOutbox` is what a module's eventing setup carries: it wakes the named
 * process manager's outbox worker, and is a no-op for a process not mounted here.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { buildProcessManager } from "../../pipeline/processBuilder.ts";
import { testEventSchema } from "../../services/__tests__/testHelpers.ts";
import { ProcessOutboxWorker } from "../outbox/processOutboxWorker.ts";
import { ProcessRuntime } from "../processRuntime.ts";
import { InMemoryProcessStore } from "../stores/inMemoryProcessStore.ts";

const triggerSchema = testEventSchema("test.process.triggered", z.object({}));

afterEach(() => {
  vi.restoreAllMocks();
});

describe("ProcessRuntime.notifyOutbox", () => {
  it("nudges the named manager's outbox only", async () => {
    const nudged: string[] = [];
    vi.spyOn(ProcessOutboxWorker.prototype, "notify").mockImplementation(function (
      this: ProcessOutboxWorker,
    ) {
      nudged.push(String(Reflect.get(this, "name")));
    });
    const runtime = new ProcessRuntime({
      store: InMemoryProcessStore.createForTesting(),
      consumersEnabled: false,
    });
    const manager = (name: string) =>
      buildProcessManager({
        name,
        applier: (pm) =>
          pm
            .state(z.object({}), {})
            .intent("noop", z.object({}), async () => {})
            .on(triggerSchema, (state) => ({ state, intents: [] })),
      });
    runtime.registerPipeline({
      pipelineName: "nudges",
      processManagers: new Map([
        ["first", manager("first")],
        ["second", manager("second")],
      ]),
    });

    runtime.notifyOutbox("second");
    runtime.notifyOutbox("unmounted");

    expect(nudged).toEqual(["second"]);
    await runtime.stop();
  });
});
