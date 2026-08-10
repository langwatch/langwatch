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
      /** @scenario 'an aggregate that many items share is a funnel too' */
      it("bounds a log contribution batch at the trace correlation bound", () => {
        expect(
          registrationOf("recordLogContribution")?.options?.coalesceMaxBatch,
        ).toBe(TRACE_CORRELATION_COALESCE_MAX_BATCH);
      });

      /** @scenario 'an aggregate that many items share is a funnel too' */
      it("bounds a metric correlation batch at the same bound", () => {
        expect(
          registrationOf("recordMetricCorrelation")?.options?.coalesceMaxBatch,
        ).toBe(TRACE_CORRELATION_COALESCE_MAX_BATCH);
      });

      // Both stay on the aggregate key. Sharding them would spread one trace's
      // correlations across groups, which the fold tolerates but which is a
      // second lever; folding the appends is what takes the group off the
      // per-item write path.
      /** @scenario 'an aggregate that many items share is a funnel too' */
      it("leaves both grouped on the trace, naming no group key of their own", () => {
        expect(
          registrationOf("recordLogContribution")?.options?.getGroupKey,
        ).toBeUndefined();
        expect(
          registrationOf("recordMetricCorrelation")?.options?.getGroupKey,
        ).toBeUndefined();
      });
    });
  });

  describe("given several queued log contributions from one trace", () => {
    describe("when the coalesced batch is processed", () => {
      /** @scenario 'an aggregate that many items share is a funnel too' */
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

      // The whole point of leaving the group key alone: the folds keyed on the
      // trace must still see one aggregate, however the appends were batched.
      /** @scenario 'an aggregate that many items share is a funnel too' */
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
      /** @scenario 'an aggregate that many items share is a funnel too' */
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
