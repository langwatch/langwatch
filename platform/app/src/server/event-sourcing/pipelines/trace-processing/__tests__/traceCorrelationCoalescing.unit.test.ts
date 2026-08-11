/**
 * ADR-066 pillar 2 for the trace-side correlation commands.
 *
 * `recordLogContribution` and `recordMetricCorrelation` name no group key, so
 * both fall back to the aggregate — the trace. Every log record and metric
 * exemplar correlated to one trace therefore funnels into a single queue group,
 * and without folding, a chatty trace appends one tiny event_log insert per item
 * while every other trace's correlations wait behind it.
 *
 * Their `log_processing` and `metric_processing` counterparts already fold; the
 * trace-side pair is the same producer shape reached by the default key rather
 * than an explicit one.
 *
 * See specs/event-sourcing/producer-append-coalescing.feature.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Event } from "../../../domain/types";
import { processCommandBatch } from "../../../services/commands/commandDispatcher";
import type { JobRegistryEntry } from "../../../services/queues/queueManager";
import { QueueManager } from "../../../services/queues/queueManager";
import { RecordLogContributionCommand } from "../commands/recordLogContributionCommand";
import { RecordMetricCorrelationCommand } from "../commands/recordMetricCorrelationCommand";
import { createTraceProcessingPipeline } from "../pipeline";
import {
  LOG_CONTRIBUTED_EVENT_TYPE,
  METRIC_DATA_POINT_CORRELATED_EVENT_TYPE,
  RECORD_LOG_CONTRIBUTION_COMMAND_TYPE,
  RECORD_METRIC_CORRELATION_COMMAND_TYPE,
  TRACE_CORRELATION_COALESCE_MAX_BATCH,
} from "../schemas/constants";
import {
  buildTraceDeps,
  FIXTURE_TENANT_ID,
  FIXTURE_TRACE_ID,
  logContributionPayload,
  metricCorrelationPayload,
} from "./support/traceProcessingFixtures";

vi.mock("../../../utils/killSwitch", () => ({
  isComponentDisabled: vi.fn().mockResolvedValue(false),
}));

import { isComponentDisabled } from "../../../utils/killSwitch";

const mockedIsComponentDisabled = vi.mocked(isComponentDisabled);

function registrationOf(commandName: string) {
  return createTraceProcessingPipeline(buildTraceDeps()).commands.find(
    (candidate) => candidate.name === commandName,
  );
}

function logBatchParamsFor({
  payloads,
  storeEventsFn,
}: {
  payloads: ReturnType<typeof logContributionPayload>[];
  storeEventsFn: (events: Event[], context: unknown) => Promise<void>;
}) {
  return {
    payloads: payloads as unknown as Record<string, unknown>[],
    commandType: RECORD_LOG_CONTRIBUTION_COMMAND_TYPE,
    commandSchema: RecordLogContributionCommand.schema,
    handler: new RecordLogContributionCommand(),
    getAggregateId: RecordLogContributionCommand.getAggregateId,
    storeEventsFn: storeEventsFn as never,
    aggregateType: "trace" as const,
    commandName: "recordLogContribution",
    pipelineName: "trace_processing",
  };
}

function metricBatchParamsFor({
  payloads,
  storeEventsFn,
}: {
  payloads: ReturnType<typeof metricCorrelationPayload>[];
  storeEventsFn: (events: Event[], context: unknown) => Promise<void>;
}) {
  return {
    payloads: payloads as unknown as Record<string, unknown>[],
    commandType: RECORD_METRIC_CORRELATION_COMMAND_TYPE,
    commandSchema: RecordMetricCorrelationCommand.schema,
    handler: new RecordMetricCorrelationCommand(),
    getAggregateId: RecordMetricCorrelationCommand.getAggregateId,
    storeEventsFn: storeEventsFn as never,
    aggregateType: "trace" as const,
    commandName: "recordMetricCorrelation",
    pipelineName: "trace_processing",
  };
}

describe("trace correlation append coalescing", () => {
  beforeEach(() => {
    mockedIsComponentDisabled.mockResolvedValue(false);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("given the trace-processing pipeline is defined", () => {
    describe("when the correlation commands are registered", () => {
      it("bounds a log contribution batch at the trace correlation bound", () => {
        expect(
          registrationOf("recordLogContribution")?.options?.coalesceMaxBatch,
        ).toBe(TRACE_CORRELATION_COALESCE_MAX_BATCH);
      });

      it("bounds a metric correlation batch at the same bound", () => {
        expect(
          registrationOf("recordMetricCorrelation")?.options?.coalesceMaxBatch,
        ).toBe(TRACE_CORRELATION_COALESCE_MAX_BATCH);
      });

      // Both stay on the aggregate key. Sharding them would spread one trace's
      // correlations across groups, which the fold tolerates but which is a
      // second lever; folding the appends is what takes the group off the
      // per-item write path.
      //
      // Read the grouping the way queueManager resolves it — the registration
      // option OR a static on the handler class — so a group key added to
      // either place is caught. Resolve the registration first: `?.options`
      // on a missing command is undefined too, so without this the assertion
      // would pass for a command that is no longer registered at all.
      it("leaves both grouped on the trace, naming no group key of their own", () => {
        for (const [name, handlerClass] of [
          ["recordLogContribution", RecordLogContributionCommand],
          ["recordMetricCorrelation", RecordMetricCorrelationCommand],
        ] as const) {
          const registration = registrationOf(name);
          expect(registration).toBeDefined();
          expect(
            registration?.options?.getGroupKey ??
              (handlerClass as { getGroupKey?: unknown }).getGroupKey,
          ).toBeUndefined();
        }
      });
    });

    // The bound assertions above are blind to the NUMBER: coalescing only
    // engages above 1 (`(coalesceMaxBatch ?? 1) > 1` in queueManager), so a
    // bound edited down to 1 would disable the fold and leave every one of
    // them green. Run the real registrations through the real QueueManager and
    // assert the batch processor is actually installed — that is what makes
    // this suite fail if the fix silently regresses to a no-op.
    describe("when the real registrations are wired into the queue manager", () => {
      // The pipeline's own registration objects, wired by the real
      // QueueManager. Narrowed to the commands asserted on because
      // initializeCommandQueues constructs every handler it is given, and
      // RecordSpanCommand's zero-arg constructor reaches for prisma.
      function registryFor() {
        const globalJobRegistry = new Map<string, JobRegistryEntry>();
        const manager = new QueueManager({
          aggregateType: "trace",
          pipelineName: "trace_processing",
          globalQueue: {
            send: vi.fn().mockResolvedValue(void 0),
            sendBatch: vi.fn().mockResolvedValue(void 0),
            close: vi.fn().mockResolvedValue(void 0),
            waitUntilReady: vi.fn().mockResolvedValue(void 0),
          } as never,
          globalJobRegistry,
        });
        const wired = new Set([
          "recordLogContribution",
          "recordMetricCorrelation",
          "addAnnotation",
        ]);
        const registrations = createTraceProcessingPipeline(
          buildTraceDeps(),
        ).commands.filter((candidate) => wired.has(candidate.name));
        if (registrations.length !== wired.size) {
          // A precondition, not an expectation: if a command were renamed the
          // filter would quietly wire fewer than it names, and every assertion
          // below would read as a pass on a registry that was never populated.
          throw new Error(
            `expected ${wired.size} registrations, resolved ${registrations.length}`,
          );
        }

        manager.initializeCommandQueues(
          registrations as never,
          vi.fn(),
          "trace_processing",
        );
        return globalJobRegistry;
      }

      it("installs a batch processor for both correlation commands", () => {
        const registry = registryFor();

        for (const name of [
          "recordLogContribution",
          "recordMetricCorrelation",
        ]) {
          expect(
            registry.get(`trace_processing:command:${name}`)?.processBatch,
          ).toBeDefined();
        }
      });

      /** @scenario 'a low-fan-in producer is left alone' */
      it("installs none for a command that appends one event per human action", () => {
        const registry = registryFor();

        const annotation = registry.get(
          "trace_processing:command:addAnnotation",
        );
        expect(annotation).toBeDefined();
        expect(annotation?.processBatch).toBeUndefined();
        expect(annotation?.coalesceMaxBatch).toBeUndefined();
      });
    });
  });

  describe("given several queued log contributions from one trace", () => {
    describe("when the coalesced batch is processed", () => {
      /** @scenario 'many items for one aggregate become one insert' */
      it("appends them as one insert holding every contribution in dispatch order", async () => {
        const storeEventsFn = vi.fn().mockResolvedValue(undefined);
        const payloads = [0, 1, 2, 3].map((index) =>
          logContributionPayload({ index }),
        );

        await processCommandBatch(
          logBatchParamsFor({ payloads, storeEventsFn }),
        );

        expect(storeEventsFn).toHaveBeenCalledTimes(1);
        const [events, context] = storeEventsFn.mock.calls[0]!;
        expect(
          (events as Event[]).map(
            (event) => (event.data as { recordId: string }).recordId,
          ),
        ).toEqual(payloads.map((payload) => payload.recordId));
        expect(
          (events as Event[]).every(
            (event) => event.type === LOG_CONTRIBUTED_EVENT_TYPE,
          ),
        ).toBe(true);
        expect(context).toEqual({ tenantId: FIXTURE_TENANT_ID });
      });

      /** @scenario 'coalescing preserves every item' */
      it("keeps each contribution's idempotency key so a retry cannot duplicate it", async () => {
        const storeEventsFn = vi.fn().mockResolvedValue(undefined);
        const payloads = [0, 1].map((index) =>
          logContributionPayload({ index }),
        );

        await processCommandBatch(
          logBatchParamsFor({ payloads, storeEventsFn }),
        );

        const [events] = storeEventsFn.mock.calls[0]!;
        expect(
          (events as Event[]).map((event) => event.idempotencyKey),
        ).toEqual(
          payloads.map((payload) => `${FIXTURE_TENANT_ID}:${payload.recordId}`),
        );
      });

      // "The batch completes only after the insert is durably acknowledged" —
      // the clause that makes a coalesced batch safe to ack as one unit. If the
      // batch resolved before the append settled, the queue would drop 256
      // items' worth of work on a store that had not committed.
      /** @scenario 'coalescing preserves every item' */
      it("does not complete until the append has settled", async () => {
        let releaseStore: (() => void) | undefined;
        const settled = new Promise<void>((resolve) => {
          releaseStore = resolve;
        });
        const storeEventsFn = vi.fn().mockReturnValue(settled);
        let completed = false;

        const running = processCommandBatch(
          logBatchParamsFor({
            payloads: [0, 1].map((index) => logContributionPayload({ index })),
            storeEventsFn,
          }),
        ).then(() => {
          completed = true;
        });

        await vi.waitFor(() => {
          expect(storeEventsFn).toHaveBeenCalledTimes(1);
        });
        // The append is in flight. Give the batch every chance to finish early;
        // it must not, because nothing has acknowledged the insert yet.
        for (let tick = 0; tick < 10; tick++) {
          await Promise.resolve();
        }
        expect(completed).toBe(false);

        releaseStore?.();
        await running;
        expect(completed).toBe(true);
      });

      // "A retry of the batch neither duplicates nor drops events" — at this
      // layer that reduces to the keys being a pure function of the payloads,
      // so a redelivered batch presents the SAME identities to the event log's
      // dedup rather than a fresh set. (The log's own collapsing of a repeated
      // key is covered by recordSpanCommand.dedup.integration.test.ts.)
      /** @scenario 'coalescing preserves every item' */
      it("presents identical event identities when the same batch is retried", async () => {
        const keysFor = async () => {
          const storeEventsFn = vi.fn().mockResolvedValue(undefined);
          await processCommandBatch(
            logBatchParamsFor({
              payloads: [0, 1, 2].map((index) =>
                logContributionPayload({ index }),
              ),
              storeEventsFn,
            }),
          );
          const [events] = storeEventsFn.mock.calls[0]!;
          return (events as Event[]).map((event) => event.idempotencyKey);
        };

        const first = await keysFor();
        const second = await keysFor();

        expect(second).toEqual(first);
        expect(new Set(first).size).toBe(first.length);
      });

      // The whole point of leaving the group key alone: the folds keyed on the
      // trace must still see one aggregate, however the appends were batched.
      /** @scenario 'many items for one aggregate become one insert' */
      it("emits every contribution's event as a single trace aggregate", async () => {
        const storeEventsFn = vi.fn().mockResolvedValue(undefined);
        const payloads = [0, 1, 2].map((index) =>
          logContributionPayload({ index }),
        );

        await processCommandBatch(
          logBatchParamsFor({ payloads, storeEventsFn }),
        );

        const [events] = storeEventsFn.mock.calls[0]!;
        expect(
          new Set((events as Event[]).map((event) => event.aggregateId)),
        ).toEqual(new Set([FIXTURE_TRACE_ID]));
      });
    });

    describe("when the command is killed for the tenant", () => {
      it("appends nothing for the whole batch", async () => {
        mockedIsComponentDisabled.mockResolvedValue(true);
        const storeEventsFn = vi.fn().mockResolvedValue(undefined);
        const payloads = [0, 1, 2].map((index) =>
          logContributionPayload({ index }),
        );

        await processCommandBatch(
          logBatchParamsFor({ payloads, storeEventsFn }),
        );

        expect(storeEventsFn).not.toHaveBeenCalled();
      });
    });
  });

  describe("given several queued metric correlations from one trace", () => {
    describe("when the coalesced batch is processed", () => {
      /** @scenario 'many items for one aggregate become one insert' */
      it("appends them as one insert holding every correlation", async () => {
        const storeEventsFn = vi.fn().mockResolvedValue(undefined);
        const payloads = [0, 1, 2].map((index) =>
          metricCorrelationPayload({ index }),
        );

        await processCommandBatch(
          metricBatchParamsFor({ payloads, storeEventsFn }),
        );

        expect(storeEventsFn).toHaveBeenCalledTimes(1);
        const [events] = storeEventsFn.mock.calls[0]!;
        expect(
          (events as Event[]).map(
            (event) => (event.data as { pointId: string }).pointId,
          ),
        ).toEqual(payloads.map((payload) => payload.pointId));
        expect(
          (events as Event[]).every(
            (event) => event.type === METRIC_DATA_POINT_CORRELATED_EVENT_TYPE,
          ),
        ).toBe(true);
      });

      // The metric key is five parts to the log key's two, and it is the only
      // thing between a retried batch and duplicate exemplar rows.
      /** @scenario 'coalescing preserves every item' */
      it("keeps each correlation's idempotency key so a retry cannot duplicate it", async () => {
        const storeEventsFn = vi.fn().mockResolvedValue(undefined);
        const payloads = [0, 1].map((index) =>
          metricCorrelationPayload({ index }),
        );

        await processCommandBatch(
          metricBatchParamsFor({ payloads, storeEventsFn }),
        );

        const [events] = storeEventsFn.mock.calls[0]!;
        expect(
          (events as Event[]).map((event) => event.idempotencyKey),
        ).toEqual(
          payloads.map((payload) =>
            RecordMetricCorrelationCommand.makeJobId(payload),
          ),
        );
      });

      // The handler drops a correlation whose ids are malformed by returning no
      // event. Folding must not let that rejection take its batch-mates with it.
      /** @scenario 'coalescing preserves every item' */
      it("drops only the malformed correlation and appends the rest", async () => {
        const storeEventsFn = vi.fn().mockResolvedValue(undefined);
        const payloads = [
          metricCorrelationPayload({ index: 0 }),
          { ...metricCorrelationPayload({ index: 1 }), spanId: "0".repeat(16) },
          metricCorrelationPayload({ index: 2 }),
        ];

        await processCommandBatch(
          metricBatchParamsFor({ payloads, storeEventsFn }),
        );

        expect(storeEventsFn).toHaveBeenCalledTimes(1);
        const [events] = storeEventsFn.mock.calls[0]!;
        expect(
          (events as Event[]).map(
            (event) => (event.data as { pointId: string }).pointId,
          ),
        ).toEqual([payloads[0]!.pointId, payloads[2]!.pointId]);
      });
    });
  });
});
