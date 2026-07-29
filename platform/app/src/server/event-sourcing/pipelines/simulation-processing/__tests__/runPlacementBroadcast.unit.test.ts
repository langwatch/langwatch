/**
 * Where a run sits has to survive the whole way from a dispatched command to
 * the pushed payload, because the client filters on it.
 *
 * This drives the real seams rather than asserting on a shape: the command's
 * own schema through `processCommand` (which builds the command from
 * `validate()`'s PARSED payload, so a field the schema omits is stripped before
 * the handler ever sees it), the real command handler, and the subscriber the
 * pipeline actually mounts — including its enqueue filter, since a filtered
 * event never becomes a job at all.
 *
 * The regression it pins: `snapshotUpdateBroadcast` reads the batch and set ids
 * off the event, having no fold to read them back from. Drop them anywhere in
 * that chain and every push after `started` arrives with the run id alone,
 * which a set-scoped panel discards — the panels go quiet mid-run while the
 * events themselves look perfectly healthy.
 */
import { describe, expect, it, vi } from "vitest";

import type { BroadcastService } from "~/server/app-layer/broadcast/broadcast.service";
import type { TraceSummaryData } from "~/server/app-layer/traces/types";

import type { Event } from "../../../domain/types";
import type { FoldProjectionStore } from "../../../projections/foldProjection.types";
import { processCommand } from "../../../services/commands/commandDispatcher";
import type { EventSubscriberDefinition } from "../../../subscribers/eventSubscriber.types";
import {
  DeleteRunCommand,
  FinishRunCommand,
  MessageSnapshotCommand,
} from "../commands";
import { createSimulationProcessingPipeline } from "../pipeline";
import type { SimulationRunStateData } from "../projections/simulationRunState.foldProjection";
import type { SimulationProcessingEvent } from "../schemas/events";

const TENANT_ID = "project-1";
const SCENARIO_RUN_ID = "run-1";

function foldStore<State>(): FoldProjectionStore<State> {
  return {
    get: vi.fn().mockResolvedValue(null),
    store: vi.fn().mockResolvedValue(undefined),
  };
}

/**
 * The pipeline as the composition root builds it, so the subscriber under test
 * is the mounted one and not a second construction of the same factory.
 */
function mountedSubscriber(pushes: string[]) {
  const broadcast = {
    broadcastToTenant: vi
      .fn()
      .mockImplementation(async (_tenantId: string, payload: string) => {
        pushes.push(payload);
      }),
  } as unknown as BroadcastService;

  const pipeline = createSimulationProcessingPipeline({
    simulationRunStore: foldStore<SimulationRunStateData>(),
    traceSummaryStore: foldStore<TraceSummaryData>(),
    broadcast,
    cancellationPublisher: null,
    deriveScenarioRoleMetrics: async () => ({
      scenarioRoleCosts: {},
      scenarioRoleLatencies: {},
    }),
    isSaas: false,
    commands: { port: () => async () => {} } as never,
    scenarioExecutionDispatch: {
      executeRun: async () => void 0,
      readRunStatus: async () => null,
      emitFailure: async () => void 0,
      lookupScenario: async () => null,
    },
  });

  const subscriber = pipeline.eventSubscribers.get("snapshotUpdateBroadcast");
  if (!subscriber) {
    throw new Error("snapshotUpdateBroadcast is not mounted on the pipeline");
  }
  return subscriber as EventSubscriberDefinition<SimulationProcessingEvent>;
}

/** The routing seam: filter first, and only then a job that handles. */
async function deliver({
  subscriber,
  event,
}: {
  subscriber: EventSubscriberDefinition<SimulationProcessingEvent>;
  event: SimulationProcessingEvent;
}): Promise<void> {
  if (subscriber.options?.enqueue?.filter?.(event) === false) return;
  await subscriber.handle(event, {
    tenantId: String(event.tenantId),
    aggregateId: String(event.aggregateId),
  });
}

/**
 * Dispatches a command exactly as the queue consumer does and returns whatever
 * the run's subscribers pushed for the events it committed.
 */
async function pushesFor({
  command,
  commandName,
  payload,
}: {
  command: typeof MessageSnapshotCommand;
  commandName: string;
  payload: Record<string, unknown>;
}): Promise<Array<Record<string, unknown>>> {
  const pushes: string[] = [];
  const subscriber = mountedSubscriber(pushes);

  await processCommand({
    payload,
    commandType: command.schema.type,
    commandSchema: command.schema,
    handler: new command(),
    getAggregateId: command.getAggregateId,
    aggregateType: "simulation_run",
    commandName,
    pipelineName: "simulation_processing",
    storeEventsFn: async (events: Event[]) => {
      for (const event of events) {
        await deliver({
          subscriber,
          event: event as SimulationProcessingEvent,
        });
      }
    },
  });

  return pushes.map((push) => JSON.parse(push) as Record<string, unknown>);
}

describe("run placement on the simulation update broadcast", () => {
  describe("given a run reported into a named scenario set", () => {
    describe("when a message_snapshot is dispatched with the run's placement", () => {
      it("pushes the batch and set ids the set-scoped panels filter on", async () => {
        const pushes = await pushesFor({
          command: MessageSnapshotCommand,
          commandName: "messageSnapshot",
          payload: {
            tenantId: TENANT_ID,
            occurredAt: 1_700_000_000_000,
            scenarioRunId: SCENARIO_RUN_ID,
            batchRunId: "batch-9",
            scenarioSetId: "set-checkout",
            messages: [{ id: "m1", role: "assistant", content: "hi" }],
            traceIds: [],
          },
        });

        expect(pushes).toEqual([
          {
            event: "simulation_updated",
            scenarioRunId: SCENARIO_RUN_ID,
            batchRunId: "batch-9",
            scenarioSetId: "set-checkout",
          },
        ]);
      });
    });

    describe("when the run finishes", () => {
      it("pushes the placement so the terminal state reaches the same panel", async () => {
        const pushes = await pushesFor({
          command: FinishRunCommand as unknown as typeof MessageSnapshotCommand,
          commandName: "finishRun",
          payload: {
            tenantId: TENANT_ID,
            occurredAt: 1_700_000_000_001,
            scenarioRunId: SCENARIO_RUN_ID,
            batchRunId: "batch-9",
            scenarioSetId: "set-checkout",
            status: "SUCCESS",
          },
        });

        expect(pushes).toEqual([
          {
            event: "simulation_updated",
            scenarioRunId: SCENARIO_RUN_ID,
            batchRunId: "batch-9",
            scenarioSetId: "set-checkout",
          },
        ]);
      });
    });
  });

  describe("given a whole scenario set being archived", () => {
    describe("when a run is deleted with the set the request named", () => {
      it("pushes the set id, with no batch id to guess at", async () => {
        const pushes = await pushesFor({
          command: DeleteRunCommand as unknown as typeof MessageSnapshotCommand,
          commandName: "deleteRun",
          payload: {
            tenantId: TENANT_ID,
            occurredAt: 1_700_000_000_002,
            scenarioRunId: SCENARIO_RUN_ID,
            scenarioSetId: "set-checkout",
          },
        });

        expect(pushes).toEqual([
          {
            event: "simulation_updated",
            scenarioRunId: SCENARIO_RUN_ID,
            scenarioSetId: "set-checkout",
          },
        ]);
      });
    });
  });

  describe("given an emitter that holds only the run id", () => {
    describe("when a run is finished without its placement", () => {
      it("pushes the run id alone rather than inventing a set", async () => {
        const pushes = await pushesFor({
          command: FinishRunCommand as unknown as typeof MessageSnapshotCommand,
          commandName: "finishRun",
          payload: {
            tenantId: TENANT_ID,
            occurredAt: 1_700_000_000_003,
            scenarioRunId: SCENARIO_RUN_ID,
            status: "ERROR",
          },
        });

        expect(pushes).toEqual([
          { event: "simulation_updated", scenarioRunId: SCENARIO_RUN_ID },
        ]);
      });
    });
  });
});
