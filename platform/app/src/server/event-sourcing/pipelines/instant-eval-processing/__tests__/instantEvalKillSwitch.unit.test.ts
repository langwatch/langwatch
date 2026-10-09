import { describe, expect, it, vi } from "vitest";
import { createTenantId } from "../../../domain/tenantId";
import { ProjectionRouter } from "../../../projections/projectionRouter";
import {
  processCommand,
  processCommandBatch,
} from "../../../services/commands/commandDispatcher";
import {
  type JobRegistryEntry,
  QueueManager,
} from "../../../services/queues/queueManager";
import { createInstantEvalProcessingPipeline } from "../pipeline";
import {
  page,
  pageJudged,
  planned,
  requested,
} from "../process-manager/__tests__/instantEvalProcessFlowHarness";
import { createInstantEvalJudgePageHandler } from "../process-manager/instantEvalIntentHandlers";
import type { InstantEvalProcessingEvent } from "../schemas/events";

// The default runner reuses module graphs. This suite deliberately exercises
// the real kill-switch boundary, after sibling suites have mocked it.
vi.hoisted(() => {
  vi.resetModules();
});
vi.unmock("../../../utils/killSwitch");

const commands = [
  "requestRun",
  "recordPlanned",
  "recordPageJudged",
  "requestCancel",
  "recordFinished",
] as const;
const payloads = {
  requestRun: requested.data,
  recordPlanned: planned().data,
  recordPageJudged: pageJudged({ page: 1, ...page() }).data,
  requestCancel: { runId: "instanteval_1", requestedByUserId: null },
  recordFinished: {
    runId: "instanteval_1",
    outcome: "finished",
    errorCode: null,
    inputTokens: 900,
    requests: 500,
    costUsd: 0.1,
    priceUsd: 0.13,
  },
};

function harness() {
  let killed = false;
  const receipts: unknown[] = [];
  const record = vi.fn(async (rows: readonly unknown[]) => {
    receipts.push(...rows);
  });
  const store = {
    load: vi.fn(async () => null),
    store: vi.fn(async () => undefined),
  };
  const pipeline = createInstantEvalProcessingPipeline({
    instantEvalRunStore: store,
    interruptions: { record },
    dispatch: { runPort: {} as never, commands: () => ({}) as never },
  });
  const flags = { isEnabled: vi.fn(async () => killed) } as never;
  const events: InstantEvalProcessingEvent[] = [];
  const params = (name: (typeof commands)[number], runId = "instanteval_1") => {
    const registration = pipeline.commands.find((c) => c.name === name)!;
    return {
      payload: {
        ...payloads[name],
        runId,
        tenantId: "project-1",
        occurredAt: 1_000,
      },
      commandType: registration.handlerClass.schema.type,
      commandSchema: registration.handlerClass.schema,
      handler: new registration.handlerClass(),
      getAggregateId: registration.handlerClass.getAggregateId,
      storeEventsFn: async (stored: InstantEvalProcessingEvent[]) => {
        events.push(...stored);
      },
      aggregateType: "instant_eval_run" as const,
      commandName: name,
      pipelineName: "instant_eval_processing",
      featureFlagService: flags,
      onKillSwitchSkip: registration.options?.onKillSwitchSkip,
    };
  };
  const queue = { initializeStateProjectionQueues: vi.fn() };
  const router = new ProjectionRouter<InstantEvalProcessingEvent>(
    "instant_eval_run",
    "instant_eval_processing",
    queue as never,
    flags,
  );
  router.registerStateProjection(
    pipeline.stateProjections!.get("instantEvalRun")!,
  );
  router.initializeStateProjectionQueues();
  const [, single, batch] =
    queue.initializeStateProjectionQueues.mock.calls[0]!;
  const project = (sources: InstantEvalProcessingEvent[]) =>
    sources.length === 1
      ? single("instantEvalRun", sources[0], {
          tenantId: createTenantId("project-1"),
        })
      : batch("instantEvalRun", sources, {
          tenantId: createTenantId("project-1"),
        });
  return {
    kill: () => {
      killed = true;
    },
    restore: () => {
      killed = false;
    },
    receipts,
    record,
    params,
    events,
    store,
    project,
  };
}

describe("Instant Eval kill-switch receipts", () => {
  /** @scenario Every disabled run command records its actual refusal */
  it("observes an actual queued facade request only when the worker later refuses it", async () => {
    const h = harness();
    const registry = new Map<string, JobRegistryEntry>();
    const queued: Record<string, unknown>[] = [];
    const queue = new QueueManager<InstantEvalProcessingEvent>({
      aggregateType: "instant_eval_run",
      pipelineName: "instant_eval_processing",
      featureFlagService: { isEnabled: async () => true } as never,
      globalJobRegistry: registry as never,
      globalQueue: {
        send: async (payload: Record<string, unknown>) => {
          queued.push(payload);
        },
      } as never,
    });
    const params = h.params("requestRun");
    queue.initializeCommandQueues(
      [
        {
          name: "requestRun",
          handlerClass: params.handler.constructor as never,
          options: { onKillSwitchSkip: params.onKillSwitchSkip },
        },
      ],
      params.storeEventsFn,
      "instant_eval_processing",
    );
    await queue.getCommandQueue("requestRun")!.send(params.payload);
    expect(h.receipts).toEqual([]);
    const job = registry.get("instant_eval_processing:command:requestRun")!;
    await job.process(queued[0]!);
    expect(h.receipts).toEqual([
      expect.objectContaining({
        componentName: "requestRun",
        runId: "instanteval_1",
      }),
    ]);
    expect(h.events).toEqual([]);
  });

  describe.each(commands)("when %s is disabled after enqueue", (name) => {
    /** @scenario Every disabled run command records its actual refusal */
    it("records the run and stage without appending an event", async () => {
      const h = harness();
      const queued = h.params(name);
      h.kill();
      await processCommand(queued);
      expect(h.receipts).toEqual([
        expect.objectContaining({
          projectId: "project-1",
          runId: "instanteval_1",
          componentType: "command",
          componentName: name,
        }),
      ]);
      expect(h.events).toEqual([]);
      h.restore();
      expect(h.receipts).toHaveLength(1);
    });

    /** @scenario Every disabled run command records its actual refusal */
    it("records every refused item in a batch", async () => {
      const h = harness();
      h.kill();
      await processCommandBatch({
        ...h.params(name),
        payloads: [h.params(name).payload, h.params(name, "run-2").payload],
      });
      expect(h.receipts).toEqual([
        expect.objectContaining({ runId: "instanteval_1" }),
        expect.objectContaining({ runId: "run-2" }),
      ]);
      expect(h.events).toEqual([]);
    });
  });

  /** @scenario Receipt write failure retries only the refused job */
  it("rejects a batched command skip before acknowledging lost work", async () => {
    const h = harness();
    h.kill();
    h.record.mockRejectedValueOnce(new Error("receipt unavailable"));
    const args = h.params("recordPageJudged");
    await expect(
      processCommandBatch({ ...args, payloads: [args.payload] }),
    ).rejects.toThrow("receipt unavailable");
    expect(h.events).toEqual([]);
    await processCommandBatch({ ...args, payloads: [args.payload] });
    expect(h.receipts).toHaveLength(1);
  });

  /** @scenario A skipped projection records every refused event */
  it("records single and batched projection event identities", async () => {
    const h = harness();
    h.kill();
    await h.project([requested]);
    const second = {
      ...planned(),
      id: "event-other",
      aggregateId: "run-2",
      data: { ...planned().data, runId: "run-2" },
    } as InstantEvalProcessingEvent;
    await h.project([planned(), second]);
    expect(h.receipts).toEqual([
      expect.objectContaining({
        runId: "instanteval_1",
        componentType: "projection",
        operationKey: requested.id,
      }),
      expect.objectContaining({
        runId: "instanteval_1",
        operationKey: planned().id,
      }),
      expect.objectContaining({ runId: "run-2", operationKey: "event-other" }),
    ]);
    expect(h.store.store).not.toHaveBeenCalled();
  });

  /** @scenario Receipt write failure retries only the refused job */
  it("rejects a projection job when receipt storage fails", async () => {
    const h = harness();
    h.kill();
    h.record.mockRejectedValueOnce(new Error("receipt unavailable"));
    await expect(h.project([requested])).rejects.toThrow("receipt unavailable");
    expect(h.store.store).not.toHaveBeenCalled();
    await h.project([requested]);
    expect(h.receipts).toHaveLength(1);
  });

  /** @scenario A paid page refusal does not repeat judging */
  it("retries only recording after a paid page's outcome exists", async () => {
    const h = harness();
    const judgePage = vi.fn(async () => page());
    let queued: ReturnType<typeof h.params> | undefined;
    const handler = createInstantEvalJudgePageHandler({
      runPort: { judgePage } as never,
      commands: () =>
        ({
          recordPageJudged: async () => {
            queued = h.params("recordPageJudged");
          },
        }) as never,
    });
    await handler(
      {
        runId: "instanteval_1",
        projectId: "project-1",
        page: 1,
        afterTraceId: null,
        afterSpanId: null,
        pageSize: 500,
        remaining: 500,
        keyColumns: ["ThreadId"],
      },
      { attempt: 1 } as never,
    );
    h.kill();
    h.record.mockRejectedValueOnce(new Error("receipt unavailable"));
    await expect(processCommand(queued!)).rejects.toThrow(
      "receipt unavailable",
    );
    await processCommand(queued!);
    expect(judgePage).toHaveBeenCalledOnce();
    expect(h.receipts).toHaveLength(1);
  });

  /** @scenario Enabled processing preserves normal events and counters */
  it("appends and projects real enabled command events with no receipts", async () => {
    const h = harness();
    for (const name of commands) await processCommand(h.params(name));
    expect(h.events).toHaveLength(5);
    await h.project(h.events);
    expect(h.store.store).toHaveBeenCalledWith(
      expect.objectContaining({
        state: expect.objectContaining({
          status: "FINISHED",
          progress: 500,
          total: 1_200,
        }),
      }),
      expect.anything(),
    );
    expect(h.receipts).toEqual([]);
  });
});
