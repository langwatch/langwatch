import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { EvaluationRunService } from "~/server/app-layer/evaluations/evaluation-run.service";
import { EvaluationRunClickHouseRepository } from "~/server/app-layer/evaluations/repositories/evaluation-run.clickhouse.repository";
import { SpanStorageService } from "~/server/app-layer/traces/span-storage.service";
import { SpanStorageClickHouseRepository } from "~/server/app-layer/traces/repositories/span-storage.clickhouse.repository";
import { TraceSummaryService } from "~/server/app-layer/traces/trace-summary.service";
import { TraceSummaryClickHouseRepository } from "~/server/app-layer/traces/repositories/trace-summary.clickhouse.repository";
import type { AggregateType } from "../../../../";
import { definePipeline } from "../../../../";
import {
  getTestClickHouseClient,
  getTestRedisConnection,
} from "../../../../__tests__/integration/testContainers";
import {
  cleanupTestDataForTenant,
  createTestTenantId,
  getTenantIdString,
} from "../../../../__tests__/integration/testHelpers";
import { EventSourcing } from "../../../../eventSourcing";
import { EventStoreClickHouse } from "../../../../stores/eventStoreClickHouse";
import { EventRepositoryClickHouse } from "../../../../stores/repositories/eventRepositoryClickHouse";
import { mapCommands } from "../../../../mapCommands";
import { RecordSpanCommand } from "../../commands/recordSpanCommand";
import { AssignTopicCommand } from "../../commands/assignTopicCommand";
import { createSpanStorageMapProjection } from "../../projections/spanStorage.mapProjection";
import { createTraceSummaryFoldProjection } from "../../projections/traceSummary.foldProjection";
import type { TraceProcessingEvent } from "../../schemas/events";
import type { OtlpSpan } from "../../schemas/otlp";
import { SpanAppendStore } from "../../projections/spanStorage.store";
import { TraceSummaryStore } from "../../projections/traceSummary.store";
import { createCustomEvaluationSyncReactor } from "../customEvaluationSync.reactor";
import { StartEvaluationCommand } from "../../../../pipelines/evaluation-processing/commands/startEvaluation.command";
import { CompleteEvaluationCommand } from "../../../../pipelines/evaluation-processing/commands/completeEvaluation.command";
import { ReportEvaluationCommand } from "../../../../pipelines/evaluation-processing/commands/reportEvaluation.command";
import { createEvaluationRunFoldProjection } from "../../../../pipelines/evaluation-processing/projections";
import { EvaluationRunStore } from "../../../../pipelines/evaluation-processing/projections/evaluationRun.store";
import type { EvaluationProcessingEvent } from "../../../../pipelines/evaluation-processing/schemas/events";

// Skip when running without testcontainers
const hasTestcontainers = !!(
  process.env.TEST_CLICKHOUSE_URL || process.env.CI_CLICKHOUSE_URL
);

/**
 * Subclass that injects no-op dependencies for PII/cost/token enrichment.
 * This avoids the need for a real Prisma connection in these tests.
 */
class TestRecordSpanCommand extends RecordSpanCommand {
  static override readonly schema = RecordSpanCommand.schema;

  constructor() {
    super({
      piiRedactionService: { redactSpan: async () => {} },
      costEnrichmentService: { enrichSpan: async () => {} },
      tokenEstimationService: { estimateSpanTokens: async () => {} },
    });
  }
}

function generateId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).substring(7)}`;
}

/**
 * Builds an OTLP span with a `langwatch.evaluation.custom` event.
 */
function buildSpanWithEvaluation({
  traceId,
  spanId,
  evaluation,
}: {
  traceId: string;
  spanId: string;
  evaluation: Record<string, unknown>;
}): OtlpSpan {
  const startNano = BigInt(Date.now()) * 1_000_000n;
  const endNano = startNano + 100_000_000n;

  return {
    traceId,
    spanId,
    parentSpanId: null,
    name: "evaluation-span",
    kind: 1,
    startTimeUnixNano: startNano.toString(),
    endTimeUnixNano: endNano.toString(),
    attributes: [
      { key: "langwatch.span.type", value: { stringValue: "evaluation" } },
    ],
    events: [
      {
        timeUnixNano: startNano.toString(),
        name: "langwatch.evaluation.custom",
        attributes: [
          {
            key: "json_encoded_event",
            value: {
              stringValue: JSON.stringify(evaluation),
            },
          },
        ],
      },
    ],
    links: [],
    status: { code: 1, message: null },
    droppedAttributesCount: 0,
    droppedEventsCount: 0,
    droppedLinksCount: 0,
  } as unknown as OtlpSpan;
}

describe.skipIf(!hasTestcontainers)(
  "Custom Evaluation Sync Reactor - End-to-End Integration",
  () => {
    let tracePipeline: ReturnType<typeof createTestPipelines>["tracePipeline"];
    let evalPipeline: ReturnType<typeof createTestPipelines>["evalPipeline"];
    let sharedEventSourcing: ReturnType<typeof createTestPipelines>["eventSourcing"];
    let tenantId: ReturnType<typeof createTestTenantId>;
    let tenantIdString: string;

    function createTestPipelines() {
      const clickHouseClient = getTestClickHouseClient();
      const redisConnection = getTestRedisConnection();

      if (!clickHouseClient || !redisConnection) {
        throw new Error(
          "ClickHouse and Redis required for integration tests.",
        );
      }

      // Use a SINGLE EventSourcing instance for both pipelines.
      // In production, one instance registers all pipelines. Using separate
      // instances causes competing global queue consumers where one skips
      // the other's jobs as "unknown pipeline".
      const eventStore = new EventStoreClickHouse(
        new EventRepositoryClickHouse(clickHouseClient),
      );
      const eventSourcing = EventSourcing.createWithStores({
        eventStore,
        clickhouse: async () => clickHouseClient,
        redis: redisConnection,
      });

      // --- Evaluation pipeline ---
      const evalRunStore = new EvaluationRunStore(
        new EvaluationRunService(new EvaluationRunClickHouseRepository(async () => clickHouseClient)).repository,
      );
      const evalPipelineName = `eval_processing_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      const evalPipelineDef = definePipeline<EvaluationProcessingEvent>()
        .withName(evalPipelineName)
        .withAggregateType("evaluation" as AggregateType)
        .withCommand("startEvaluation", StartEvaluationCommand as any)
        .withCommand("completeEvaluation", CompleteEvaluationCommand as any)
        .withCommand("reportEvaluation", ReportEvaluationCommand as any)
        .withFoldProjection(
          "evaluationRun",
          createEvaluationRunFoldProjection({ store: evalRunStore }) as any,
        )
        .build();
      const registeredEvalPipeline =
        eventSourcing.register(evalPipelineDef);
      const evalCommands = mapCommands(registeredEvalPipeline.commands);

      // --- Trace pipeline (with customEvaluationSync reactor wired to eval pipeline) ---

      const spanAppendStore = new SpanAppendStore(
        new SpanStorageService(new SpanStorageClickHouseRepository(async () => clickHouseClient)).repository,
      );
      const traceSummaryStore = new TraceSummaryStore(
        new TraceSummaryService(new TraceSummaryClickHouseRepository(async () => clickHouseClient)).repository,
      );

      // Create the reactor with zero delay for faster tests
      const reactor = createCustomEvaluationSyncReactor({
        reportEvaluation: evalCommands.reportEvaluation,
      });
      const fastReactor = {
        ...reactor,
        options: { ...reactor.options, delay: 0 },
      };

      // No-op reactors for the other slots
      const noopReactor = {
        name: "noop",
        options: {},
        handle: async () => {},
      };

      const tracePipelineName = `trace_processing_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      const tracePipelineDef = definePipeline<TraceProcessingEvent>()
        .withName(tracePipelineName)
        .withAggregateType("trace" as AggregateType)
        .withFoldProjection(
          "traceSummary",
          createTraceSummaryFoldProjection({
            store: traceSummaryStore,
          }) as any,
        )
        .withMapProjection(
          "spanStorage",
          createSpanStorageMapProjection({
            store: spanAppendStore,
          }) as any,
        )
        .withReactor(
          "traceSummary",
          "customEvaluationSync",
          fastReactor as any,
        )
        .withReactor(
          "traceSummary",
          "evaluationTrigger",
          noopReactor as any,
        )
        .withReactor(
          "traceSummary",
          "traceUpdateBroadcast",
          noopReactor as any,
        )
        .withReactor(
          "spanStorage",
          "spanStorageBroadcast",
          noopReactor as any,
        )
        .withCommand("recordSpan", TestRecordSpanCommand as any)
        .withCommand("assignTopic", AssignTopicCommand as any)
        .build();

      const registeredTracePipeline =
        eventSourcing.register(tracePipelineDef);

      return {
        eventSourcing,
        tracePipeline: {
          ...registeredTracePipeline,
          ready: () => registeredTracePipeline.service.waitUntilReady(),
        },
        evalPipeline: {
          ...registeredEvalPipeline,
          ready: () => registeredEvalPipeline.service.waitUntilReady(),
        },
      };
    }

    beforeEach(async () => {
      const pipelines = createTestPipelines();
      tracePipeline = pipelines.tracePipeline;
      evalPipeline = pipelines.evalPipeline;
      sharedEventSourcing = pipelines.eventSourcing;
      tenantId = createTestTenantId();
      tenantIdString = getTenantIdString(tenantId);
      await Promise.all([tracePipeline.ready(), evalPipeline.ready()]);
    });

    afterEach(async () => {
      await sharedEventSourcing.close();
      await new Promise((resolve) => setTimeout(resolve, 1000));
      await cleanupTestDataForTenant(tenantIdString);
    });

    describe("when a span with langwatch.evaluation.custom event is recorded", () => {
      it("writes the evaluation to the evaluation_runs ClickHouse table", async () => {
        const traceId = generateId("trace");
        const spanId = generateId("span");
        const evaluationName = "toxicity-check";

        const span = buildSpanWithEvaluation({
          traceId,
          spanId,
          evaluation: {
            name: evaluationName,
            status: "processed",
            passed: true,
            score: 0.95,
            label: "safe",
            details: "No toxic content found",
          },
        });

        // Send the span through the trace processing pipeline
        await tracePipeline.commands.recordSpan.send({
          tenantId: tenantIdString,
          span,
          resource: { attributes: [], droppedAttributesCount: 0 },
          instrumentationScope: { name: "langwatch.test" },
          piiRedactionLevel: "DISABLED",
          occurredAt: Date.now(),
        });

        // The reactor extracts the evaluation from the span event,
        // then dispatches startEvaluation + completeEvaluation to the eval pipeline.
        // Wait for the evaluation to reach "processed" status.
        // The evaluation ID is deterministic (MD5 of JSON payload).
        // We need to find it by querying ClickHouse directly.
        const clickHouseClient = getTestClickHouseClient()!;

        let rows: Array<{
          EvaluationId: string;
          EvaluatorId: string;
          EvaluatorType: string;
          EvaluatorName: string;
          TraceId: string;
          Status: string;
          Score: number | null;
          Passed: number | null;
          Label: string | null;
          Details: string | null;
        }> = [];

        // Poll ClickHouse for the evaluation run
        const deadline = Date.now() + 30000;
        while (Date.now() < deadline) {
          const result = await clickHouseClient.query({
            query: `
              SELECT *
              FROM evaluation_runs
              WHERE TenantId = {tenantId:String}
                AND TraceId = {traceId:String}
                AND Status = 'processed'
              ORDER BY UpdatedAt DESC
              LIMIT 1 BY TenantId, EvaluationId
            `,
            query_params: { tenantId: tenantIdString, traceId },
            format: "JSONEachRow",
          });
          rows = await result.json();
          if (rows.length > 0) break;
          await new Promise((resolve) => setTimeout(resolve, 500));
        }

        expect(rows.length).toBeGreaterThan(0);

        const evalRow = rows[0]!;
        expect(evalRow.TraceId).toBe(traceId);
        expect(evalRow.Status).toBe("processed");
        expect(evalRow.EvaluatorType).toBe("custom");
        expect(evalRow.EvaluatorName).toBe(evaluationName);
        expect(evalRow.Score).toBeCloseTo(0.95);
        expect(evalRow.Passed).toBe(1); // ClickHouse UInt8
        expect(evalRow.Label).toBe("safe");
        expect(evalRow.Details).toBe("No toxic content found");
      });
    });

    describe("when a span has no evaluation events", () => {
      it("does not write any evaluation to ClickHouse", async () => {
        const traceId = generateId("trace");
        const startNano = BigInt(Date.now()) * 1_000_000n;
        const endNano = startNano + 100_000_000n;

        const span: OtlpSpan = {
          traceId,
          spanId: generateId("span"),
          parentSpanId: null,
          name: "regular-span",
          kind: 1,
          startTimeUnixNano: startNano.toString(),
          endTimeUnixNano: endNano.toString(),
          attributes: [],
          events: [],
          links: [],
          status: { code: 1, message: null },
          droppedAttributesCount: 0,
          droppedEventsCount: 0,
          droppedLinksCount: 0,
        } as unknown as OtlpSpan;

        await tracePipeline.commands.recordSpan.send({
          tenantId: tenantIdString,
          span,
          resource: { attributes: [], droppedAttributesCount: 0 },
          instrumentationScope: { name: "langwatch.test" },
          piiRedactionLevel: "DISABLED",
          occurredAt: Date.now(),
        });

        // Wait a bit to ensure processing completes
        await new Promise((resolve) => setTimeout(resolve, 3000));

        const clickHouseClient = getTestClickHouseClient()!;
        const result = await clickHouseClient.query({
          query: `
            SELECT COUNT(*) as count
            FROM evaluation_runs
            WHERE TenantId = {tenantId:String}
              AND TraceId = {traceId:String}
          `,
          query_params: { tenantId: tenantIdString, traceId },
          format: "JSONEachRow",
        });
        const rows = await result.json<{ count: string }>();
        expect(Number(rows[0]?.count ?? 0)).toBe(0);
      });
    });
  },
  120000,
);
