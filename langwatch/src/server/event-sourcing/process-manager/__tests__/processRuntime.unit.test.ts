import { z } from "zod";
import { describe, expect, it } from "vitest";

import { createTenantId } from "../../domain/tenantId";
import { buildProcessManager } from "../../pipeline/processBuilder";
import { TRIGGER_MATCH_RECORDED_EVENT_TYPE } from "../../pipelines/automations/schemas/constants";
import {
  triggerMatchRecordedEventSchema,
  type AutomationEvent,
} from "../../pipelines/automations/schemas/events";
import { ProcessRuntime } from "../processRuntime";
import { InMemoryProcessStore } from "../stores/inMemoryProcessStore";

const tenantId = createTenantId("project-1");

function physicalEvent(id: string) {
  return triggerMatchRecordedEventSchema.parse({
    id,
    idempotencyKey: "trigger-1:trace-1:30000-0",
    aggregateId: "trigger-1",
    aggregateType: "trigger",
    tenantId,
    createdAt: 1_000,
    occurredAt: 1_000,
    type: TRIGGER_MATCH_RECORDED_EVENT_TYPE,
    version: "2026-07-18",
    data: {
      triggerId: "trigger-1",
      traceId: "trace-1",
      action: "SEND_EMAIL",
      actionClass: "notify",
      traceDebounceMs: 30_000,
      notificationCadence: "immediate",
    },
  });
}

describe("ProcessRuntime", () => {
  describe("given duplicate physical rows share one logical event key", () => {
    it("evolves the process exactly once", async () => {
      const store = new InMemoryProcessStore();
      const runtime = new ProcessRuntime({ store, consumersEnabled: false });
      const definition = buildProcessManager<AutomationEvent>({
        name: "logicalInbox",
        applier: (pm) =>
          pm
            .state({ count: 0 })
            .intent("noop", z.object({}), async () => {})
            .on(TRIGGER_MATCH_RECORDED_EVENT_TYPE, (state) => ({
              state: { count: state.count + 1 },
            })),
      });
      const [subscriber] = runtime.registerPipeline<AutomationEvent>({
        pipelineName: "automations",
        processManagers: new Map([["logicalInbox", definition]]),
      }).subscribers;
      const context = {
        tenantId,
        aggregateId: "trigger-1",
        isReplay: false,
      };

      await subscriber!.handle(physicalEvent("physical-1"), context);
      await subscriber!.handle(physicalEvent("physical-2"), context);

      const process = await store.findByRef<{ count: number }>({
        ref: {
          processName: "logicalInbox",
          projectId: tenantId,
          processKey: "trigger-1",
        },
      });
      expect(process?.state).toEqual({ count: 1 });
      await runtime.stop();
    });
  });
});
