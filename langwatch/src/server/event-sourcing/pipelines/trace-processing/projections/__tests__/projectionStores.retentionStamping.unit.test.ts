import { describe, expect, it, vi } from "vitest";
import { PLATFORM_DEFAULT_RETENTION_DAYS } from "~/server/data-retention/retentionPolicy.schema";
import type { ProjectionStoreContext } from "~/server/event-sourcing/projections/projectionStoreContext";
import { createTenantId } from "~/server/event-sourcing/domain/tenantId";
import type { EvaluationRunData } from "~/server/app-layer/evaluations/types";
import type { EvaluationRunRepository } from "~/server/app-layer/evaluations/repositories/evaluation-run.repository";
import type { LogRecordStorageRepository } from "~/server/app-layer/traces/repositories/log-record-storage.repository";
import type { MetricRecordStorageRepository } from "~/server/app-layer/traces/repositories/metric-record-storage.repository";
import type { SpanStorageRepository } from "~/server/app-layer/traces/repositories/span-storage.repository";
import type { TraceSummaryData } from "~/server/app-layer/traces/types";
import type { TraceSummaryRepository } from "~/server/app-layer/traces/repositories/trace-summary.repository";
import type { GovernanceContentStripService } from "@ee/governance/services/governanceContentStrip.service";
import { EvaluationRunStore } from "../../../evaluation-processing/projections/evaluationRun.store";
import { LogRecordAppendStore } from "../logRecordStorage.store";
import { MetricRecordAppendStore } from "../metricRecordStorage.store";
import type { NormalizedLogRecord } from "../../schemas/logRecords";
import type { NormalizedMetricRecord } from "../../schemas/metricRecords";
import {
  NormalizedSpanKind,
  NormalizedStatusCode,
  type NormalizedSpan,
} from "../../schemas/spans";
import { SpanAppendStore } from "../spanStorage.store";
import { TraceSummaryStore } from "../traceSummary.store";

/**
 * @scenario No retention policy defaults to the platform default
 * @see specs/data-retention/ingestion-stamping.feature
 *
 * Regression for the trace-pipeline projection stores stamping `?? 0` instead
 * of `?? PLATFORM_DEFAULT_RETENTION_DAYS`. When the resolver can't produce a
 * policy (no resolver wired, or an unresolvable project), `buildStoreContext`
 * passes `retentionPolicy: null`. A 0 stamp means INDEFINITE under the TTL
 * sentinel (`IF(_retention_days > 0, …)`), silently leaving trace rows
 * unbounded — the opposite of the default-on contract, and divergent from the
 * scenario/experiment stores which already floored to the platform default.
 *
 * The bug was a wrong stamped VALUE, so each case executes the store's write
 * path with a null-policy context and observes the day count the repository
 * actually receives — not the generated SQL string.
 */
describe("trace-pipeline projection stores retention stamping", () => {
  const tenantId = createTenantId("project_abc");

  const nullPolicyContext: ProjectionStoreContext = {
    aggregateId: "agg_1",
    tenantId,
    retentionPolicy: null,
  };

  const makeSpan = (): NormalizedSpan => ({
    id: "span_row_1",
    traceId: "trace_1",
    spanId: "span_1",
    tenantId: String(tenantId),
    parentSpanId: null,
    parentTraceId: null,
    parentIsRemote: null,
    sampled: true,
    startTimeUnixMs: 1_700_000_000_000,
    endTimeUnixMs: 1_700_000_000_500,
    durationMs: 500,
    name: "GET /",
    kind: NormalizedSpanKind.INTERNAL,
    resourceAttributes: {},
    spanAttributes: {},
    statusCode: NormalizedStatusCode.OK,
    statusMessage: null,
    instrumentationScope: { name: "test", version: null },
    events: [],
    links: [],
    droppedAttributesCount: 0,
    droppedEventsCount: 0,
    droppedLinksCount: 0,
  });

  describe("when the projection context carries no resolved policy", () => {
    it("stamps stored_spans with the platform default, not indefinite", async () => {
      const insertSpan = vi.fn().mockResolvedValue(undefined);
      // No governance target attribute on the span, so the strip transform is a
      // passthrough and never dereferences the injected service.
      const stripService = {
        modeForOrganization: vi.fn(),
      } as unknown as GovernanceContentStripService;
      const store = new SpanAppendStore(
        { insertSpan } as unknown as SpanStorageRepository,
        stripService,
      );

      await store.append(makeSpan(), nullPolicyContext);

      expect(insertSpan).toHaveBeenCalledTimes(1);
      expect(insertSpan.mock.calls[0]![0]!.retentionDays).toBe(
        PLATFORM_DEFAULT_RETENTION_DAYS,
      );
    });

    it("stamps stored_log_records with the platform default", async () => {
      const insertLogRecord = vi.fn().mockResolvedValue(undefined);
      const store = new LogRecordAppendStore({
        insertLogRecord,
      } as unknown as LogRecordStorageRepository);

      await store.append({} as NormalizedLogRecord, nullPolicyContext);

      expect(insertLogRecord).toHaveBeenCalledWith(
        expect.anything(),
        PLATFORM_DEFAULT_RETENTION_DAYS,
      );
    });

    it("stamps stored_metric_records with the platform default", async () => {
      const insertMetricRecord = vi.fn().mockResolvedValue(undefined);
      const store = new MetricRecordAppendStore({
        insertMetricRecord,
      } as unknown as MetricRecordStorageRepository);

      await store.append({} as NormalizedMetricRecord, nullPolicyContext);

      expect(insertMetricRecord).toHaveBeenCalledWith(
        expect.anything(),
        PLATFORM_DEFAULT_RETENTION_DAYS,
      );
    });

    it("stamps trace_summaries with the platform default", async () => {
      const upsert = vi.fn().mockResolvedValue(undefined);
      const store = new TraceSummaryStore({
        upsert,
      } as unknown as TraceSummaryRepository);

      await store.store(
        { traceId: "trace_1", spanCount: 1 } as TraceSummaryData,
        nullPolicyContext,
      );

      expect(upsert).toHaveBeenCalledWith(
        expect.anything(),
        String(tenantId),
        PLATFORM_DEFAULT_RETENTION_DAYS,
      );
    });

    it("stamps evaluation_runs with the platform default", async () => {
      const upsert = vi.fn().mockResolvedValue(undefined);
      const store = new EvaluationRunStore({
        upsert,
      } as unknown as EvaluationRunRepository);

      await store.store(
        { evaluationId: "eval_1" } as EvaluationRunData,
        nullPolicyContext,
      );

      expect(upsert).toHaveBeenCalledWith(
        expect.anything(),
        String(tenantId),
        PLATFORM_DEFAULT_RETENTION_DAYS,
      );
    });
  });
});
