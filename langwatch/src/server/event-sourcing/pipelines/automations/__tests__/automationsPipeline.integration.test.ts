import { TriggerAction } from "@prisma/client";
import { z } from "zod";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createTenantId } from "../../../domain/tenantId";
import { EventSourcing } from "../../../eventSourcing";
import type { ProcessManagerApplier } from "../../../pipeline/processBuilder";
import type {
  IntentSpec,
  WakeHandler,
} from "../../../pipeline/processManagerDefinition";
import { mapCommands } from "../../../mapCommands";
import { InMemoryProcessStore } from "../../../process-manager/stores/inMemoryProcessStore";
import type { AutomationEvent } from "../schemas/events";
import { TRIGGER_MATCH_RECORDED_EVENT_TYPE } from "../schemas/constants";
import { createAutomationsPipeline } from "../pipeline";

const tenantId = createTenantId("project-1");
const emptyIntentSchema = z.object({});

const triggerSettlement: ProcessManagerApplier<AutomationEvent> = (pm) =>
  pm
    .state<{ traceIds: string[] }>({ traceIds: [] })
    .intent("noop", emptyIntentSchema, async () => {})
    .on(TRIGGER_MATCH_RECORDED_EVENT_TYPE, (state, data) => ({
      state: { traceIds: [...state.traceIds, data.traceId] },
    }));

type SweepIntents = { noop: IntentSpec<typeof emptyIntentSchema> };
const sweep: WakeHandler<Record<string, never>, SweepIntents> = (state) => ({
  state,
});
const graphAlertSweep: ProcessManagerApplier<AutomationEvent> = (pm) =>
  pm
    .state<Record<string, never>>({})
    .schedule({ everyMs: 30_000 })
    .onWake(sweep)
    .intent("noop", emptyIntentSchema, async () => {});

const command = (traceId: string, occurredAt: number) => ({
  tenantId,
  occurredAt,
  triggerId: "trigger-1",
  traceId,
  action: TriggerAction.SEND_EMAIL,
  actionClass: "notify" as const,
  traceDebounceMs: 30_000,
  notificationCadence: "immediate" as const,
});

describe("automations pipeline", () => {
  let eventSourcing: EventSourcing | undefined;

  afterEach(async () => {
    await eventSourcing?.close();
  });

  describe("given a trigger-match command is redelivered", () => {
    describe("when both physical events reach the process inbox", () => {
      it("records one logical event and consumes the match once", async () => {
        const processStore = new InMemoryProcessStore();
        eventSourcing = new EventSourcing({ processStore, redis: null });
        const pipeline = eventSourcing.register(
          createAutomationsPipeline({
            automationAuditStore: {
              append: vi.fn().mockResolvedValue(undefined),
            },
            triggerSettlement,
            graphAlertSweep,
          }),
        );
        const commands = mapCommands(pipeline.commands);

        await commands.recordTriggerMatch(command("trace-1", 1_000));
        await commands.recordTriggerMatch(command("trace-1", 2_000));

        const events = await eventSourcing
          .getEventStore<AutomationEvent>()!
          .getEvents("trigger-1", { tenantId }, "trigger");
        const process = await processStore.findByRef<{ traceIds: string[] }>({
          ref: {
            processName: "triggerSettlement",
            projectId: tenantId,
            processKey: "trigger-1",
          },
        });

        expect(events).toHaveLength(1);
        expect(events[0]?.idempotencyKey).toBe("trigger-1:trace-1");
        expect(process?.state.traceIds).toEqual(["trace-1"]);
      });
    });
  });

  describe("given several matches for one trigger", () => {
    describe("when commands and committed events are delivered", () => {
      it("keeps FIFO ordering through the trigger process", async () => {
        const processStore = new InMemoryProcessStore();
        eventSourcing = new EventSourcing({ processStore, redis: null });
        const pipeline = eventSourcing.register(
          createAutomationsPipeline({
            automationAuditStore: {
              append: vi.fn().mockResolvedValue(undefined),
            },
            triggerSettlement,
            graphAlertSweep,
          }),
        );
        const commands = mapCommands(pipeline.commands);

        await commands.recordTriggerMatch(command("trace-1", 1_000));
        await commands.recordTriggerMatch(command("trace-2", 2_000));
        await commands.recordTriggerMatch(command("trace-3", 3_000));

        const process = await processStore.findByRef<{ traceIds: string[] }>({
          ref: {
            processName: "triggerSettlement",
            projectId: tenantId,
            processKey: "trigger-1",
          },
        });

        expect(process?.state.traceIds).toEqual([
          "trace-1",
          "trace-2",
          "trace-3",
        ]);
      });
    });
  });
});
