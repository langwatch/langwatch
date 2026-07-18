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
    .on(TRIGGER_MATCH_RECORDED_EVENT_TYPE, (state, data, ctx) => ({
      state: { traceIds: [...state.traceIds, data.traceId] },
      intents: [ctx.intents.noop(`match:${data.traceId}`, {})],
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
const webhookDeliveryPrune: ProcessManagerApplier<AutomationEvent> = (pm) =>
  pm
    .state<Record<string, never>>({})
    .schedule({ everyMs: 86_400_000 })
    .onWake(sweep)
    .intent("noop", emptyIntentSchema, async () => {});

const command = (
  traceId: string,
  occurredAt: number,
  triggerId = "trigger-1",
) => ({
  tenantId,
  occurredAt,
  triggerId,
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
            webhookDeliveryPrune,
          }),
        );
        const commands = mapCommands(pipeline.commands);

        const redeliveredCommand = command("trace-1", 1_000);
        await commands.recordTriggerMatch(redeliveredCommand);
        await commands.recordTriggerMatch(redeliveredCommand);

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
        expect(events[0]?.idempotencyKey).toBe("trigger-1:trace-1:30000-0");
        expect(process?.state.traceIds).toEqual(["trace-1"]);
      });
    });
  });

  describe("given a settled trigger and trace receive later activity", () => {
    describe("when the later activity lands in a new settle window", () => {
      it("records and consumes a second evaluation round", async () => {
        const processStore = new InMemoryProcessStore();
        eventSourcing = new EventSourcing({ processStore, redis: null });
        const pipeline = eventSourcing.register(
          createAutomationsPipeline({
            automationAuditStore: {
              append: vi.fn().mockResolvedValue(undefined),
            },
            triggerSettlement,
            graphAlertSweep,
            webhookDeliveryPrune,
          }),
        );
        const commands = mapCommands(pipeline.commands);

        await commands.recordTriggerMatch(command("trace-1", 1_000));
        await commands.recordTriggerMatch(command("trace-1", 31_000));

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

        expect(events.map((event) => event.idempotencyKey)).toEqual([
          "trigger-1:trace-1:30000-0",
          "trigger-1:trace-1:30000-1",
        ]);
        expect(process?.state.traceIds).toEqual(["trace-1", "trace-1"]);
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
            webhookDeliveryPrune,
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

  describe("given two triggers in one project match the same trace", () => {
    it("keeps their process-outbox identities isolated", async () => {
      const processStore = new InMemoryProcessStore();
      eventSourcing = new EventSourcing({ processStore, redis: null });
      const pipeline = eventSourcing.register(
        createAutomationsPipeline({
          automationAuditStore: {
            append: vi.fn().mockResolvedValue(undefined),
          },
          triggerSettlement,
          graphAlertSweep,
          webhookDeliveryPrune,
        }),
      );
      const commands = mapCommands(pipeline.commands);

      await commands.recordTriggerMatch(command("trace-1", 1_000, "trigger-1"));
      await commands.recordTriggerMatch(command("trace-1", 2_000, "trigger-2"));

      const messages = await Promise.all(
        ["trigger-1", "trigger-2"].map((processKey) =>
          processStore.findMessagesByRef({
            ref: {
              processName: "triggerSettlement",
              projectId: tenantId,
              processKey,
            },
          }),
        ),
      );

      expect(messages.map((rows) => rows[0]?.messageKey)).toEqual([
        "process:trigger-1:match:trace-1",
        "process:trigger-2:match:trace-1",
      ]);
    });
  });
});
