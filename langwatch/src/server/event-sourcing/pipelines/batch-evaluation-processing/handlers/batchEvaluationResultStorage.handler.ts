import { SpanKind } from "@opentelemetry/api";
import { getLangWatchTracer } from "langwatch";
import { getClickHouseClient } from "~/server/clickhouse/client";
import { createLogger } from "../../../../../utils/logger";
import type { EventHandler } from "../../../library/domain/handlers/eventHandler";
import {
  EVALUATOR_RESULT_RECEIVED_EVENT_TYPE,
  TARGET_RESULT_RECEIVED_EVENT_TYPE,
} from "../schemas/constants";
import type {
  EvaluatorResultReceivedEvent,
  TargetResultReceivedEvent,
} from "../schemas/events";
import {
  isEvaluatorResultReceivedEvent,
  isTargetResultReceivedEvent,
} from "../schemas/typeGuards";
import { IdUtils } from "../utils/id.utils";

const TABLE_NAME = "batch_evaluation_results" as const;

/**
 * ClickHouse record for batch evaluation results.
 */
interface ClickHouseBatchEvaluationResultRecord {
  Id: string;
  TenantId: string;
  RunId: string;
  ExperimentId: string;
  RowIndex: number;
  TargetId: string;
  ResultType: "target" | "evaluator";

  // Target result fields
  DatasetEntry: string;
  Predicted: string | null;
  TargetCost: number | null;
  TargetDurationMs: number | null;
  TargetError: string | null;
  TraceId: string | null;

  // Evaluator result fields (EvaluatorId is null for target results)
  EvaluatorId: string | null;
  EvaluatorName: string | null;
  EvaluationStatus: string;
  Score: number | null;
  Label: string | null;
  Passed: number | null; // UInt8 in ClickHouse
  EvaluationDetails: string | null;
  EvaluationCost: number | null;

  CreatedAt: string;
}

type BatchEvaluationResultEvent =
  | TargetResultReceivedEvent
  | EvaluatorResultReceivedEvent;

/**
 * Event handler that writes individual batch evaluation results to ClickHouse.
 * Triggered for each TargetResultReceivedEvent and EvaluatorResultReceivedEvent.
 *
 * This materializes a query-optimized read model (batch_evaluation_results) from the event stream,
 * following the CQRS pattern where event handlers maintain read models.
 *
 * Unlike projections which aggregate state, this handler writes denormalized rows
 * for efficient filtering/sorting of individual results.
 */
export class BatchEvaluationResultStorageHandler
  implements EventHandler<BatchEvaluationResultEvent>
{
  private readonly tracer = getLangWatchTracer(
    "langwatch.batch-evaluation-processing.result-storage-handler",
  );
  private readonly logger = createLogger(
    "langwatch:batch-evaluation-processing:result-storage-handler",
  );

  /**
   * Handles a result event by writing to batch_evaluation_results.
   *
   * @param event - The TargetResultReceivedEvent or EvaluatorResultReceivedEvent
   */
  async handle(event: BatchEvaluationResultEvent): Promise<void> {
    return await this.tracer.withActiveSpan(
      "BatchEvaluationResultStorageHandler.handle",
      {
        kind: SpanKind.INTERNAL,
        attributes: {
          "event.id": event.id,
          "event.type": event.type,
          "tenant.id": event.tenantId,
          "run.id": event.data.runId,
        },
      },
      async (span) => {
        const clickHouseClient = getClickHouseClient();
        if (!clickHouseClient) {
          this.logger.warn(
            { eventId: event.id },
            "ClickHouse client not available, skipping result storage",
          );
          return;
        }

        let record: ClickHouseBatchEvaluationResultRecord;

        if (isTargetResultReceivedEvent(event)) {
          record = this.mapTargetResultToRecord(event);
          span.setAttributes({
            "result.type": "target",
            "result.index": event.data.index,
            "result.target_id": event.data.targetId,
          });
        } else if (isEvaluatorResultReceivedEvent(event)) {
          record = this.mapEvaluatorResultToRecord(event);
          span.setAttributes({
            "result.type": "evaluator",
            "result.index": event.data.index,
            "result.target_id": event.data.targetId,
            "result.evaluator_id": event.data.evaluatorId,
          });
        } else {
          this.logger.warn(
            { eventType: (event as { type: string }).type },
            "Unknown event type received",
          );
          return;
        }

        this.logger.debug(
          {
            tenantId: event.tenantId,
            runId: event.data.runId,
            resultType: record.ResultType,
            index: record.RowIndex,
            targetId: record.TargetId,
          },
          "Writing batch evaluation result to ClickHouse",
        );

        try {
          span.addEvent("result.storage.start");

          await clickHouseClient.insert({
            table: TABLE_NAME,
            values: [record],
            format: "JSONEachRow",
          });

          span.addEvent("result.storage.complete");

          this.logger.debug(
            {
              tenantId: event.tenantId,
              runId: event.data.runId,
              resultId: record.Id,
            },
            "Successfully wrote batch evaluation result to ClickHouse",
          );
        } catch (error) {
          span.addEvent("result.storage.error", {
            "error.message":
              error instanceof Error ? error.message : String(error),
          });

          this.logger.error(
            {
              tenantId: event.tenantId,
              runId: event.data.runId,
              error: error instanceof Error ? error.message : String(error),
            },
            "Failed to write batch evaluation result to ClickHouse",
          );
          throw error;
        }
      },
    );
  }

  /**
   * Maps a target result event to a ClickHouse record.
   */
  private mapTargetResultToRecord(
    event: TargetResultReceivedEvent,
  ): ClickHouseBatchEvaluationResultRecord {
    const id = IdUtils.generateDeterministicBatchResultId(
      event.tenantId,
      event.data.runId,
      event.data.index,
      event.data.targetId,
      "target",
      null,
      event.timestamp,
    );

    return {
      Id: id,
      TenantId: event.tenantId,
      RunId: event.data.runId,
      ExperimentId: event.data.experimentId,
      RowIndex: event.data.index,
      TargetId: event.data.targetId,
      ResultType: "target",

      DatasetEntry: JSON.stringify(event.data.entry),
      Predicted: event.data.predicted
        ? JSON.stringify(event.data.predicted)
        : null,
      TargetCost: event.data.cost ?? null,
      TargetDurationMs: event.data.duration ?? null,
      TargetError: event.data.error ?? null,
      TraceId: event.data.traceId ?? null,

      EvaluatorId: null,
      EvaluatorName: null,
      EvaluationStatus: "",
      Score: null,
      Label: null,
      Passed: null,
      EvaluationDetails: null,
      EvaluationCost: null,

      CreatedAt: event.timestamp.toString(),
    };
  }

  /**
   * Maps an evaluator result event to a ClickHouse record.
   */
  private mapEvaluatorResultToRecord(
    event: EvaluatorResultReceivedEvent,
  ): ClickHouseBatchEvaluationResultRecord {
    const id = IdUtils.generateDeterministicBatchResultId(
      event.tenantId,
      event.data.runId,
      event.data.index,
      event.data.targetId,
      "evaluator",
      event.data.evaluatorId,
      event.timestamp,
    );

    return {
      Id: id,
      TenantId: event.tenantId,
      RunId: event.data.runId,
      ExperimentId: event.data.experimentId,
      RowIndex: event.data.index,
      TargetId: event.data.targetId,
      ResultType: "evaluator",

      DatasetEntry: "{}",
      Predicted: null,
      TargetCost: null,
      TargetDurationMs: null,
      TargetError: null,
      TraceId: null,

      EvaluatorId: event.data.evaluatorId,
      EvaluatorName: event.data.evaluatorName ?? null,
      EvaluationStatus: event.data.status,
      Score: event.data.score ?? null,
      Label: event.data.label ?? null,
      Passed:
        event.data.passed === undefined || event.data.passed === null
          ? null
          : event.data.passed
            ? 1
            : 0,
      EvaluationDetails: event.data.details ?? null,
      EvaluationCost: event.data.cost ?? null,

      CreatedAt: event.timestamp.toString(),
    };
  }

  /**
   * Returns the event types this handler is interested in.
   */
  getEventTypes(): readonly [
    typeof TARGET_RESULT_RECEIVED_EVENT_TYPE,
    typeof EVALUATOR_RESULT_RECEIVED_EVENT_TYPE,
  ] {
    return [
      TARGET_RESULT_RECEIVED_EVENT_TYPE,
      EVALUATOR_RESULT_RECEIVED_EVENT_TYPE,
    ] as const;
  }

  /**
   * Returns data for display in debugging tools.
   */
  getDisplayData(event: BatchEvaluationResultEvent) {
    if (isTargetResultReceivedEvent(event)) {
      return this.mapTargetResultToRecord(event);
    } else if (isEvaluatorResultReceivedEvent(event)) {
      return this.mapEvaluatorResultToRecord(event);
    }
    return null;
  }
}
