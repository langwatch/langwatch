import { SpanKind } from "@opentelemetry/api";
import { getLangWatchTracer } from "langwatch";
import { getClickHouseClient } from "~/server/clickhouse/client";
import { createLogger } from "../../../../../utils/logger";
import type { EventHandler } from "../../../library/domain/handlers/eventHandler";
import {
  EVALUATOR_RESULT_EVENT_TYPE,
  TARGET_RESULT_EVENT_TYPE,
} from "../schemas/constants";
import type {
  EvaluatorResultEvent,
  TargetResultEvent,
} from "../schemas/events";
import {
  isEvaluatorResultEvent,
  isTargetResultEvent,
} from "../schemas/typeGuards";
import { IdUtils } from "../utils/id.utils";

const TABLE_NAME = "batch_evaluation_results" as const;

/**
 * ClickHouse record for batch evaluation results.
 */
interface ClickHouseExperimentRunResultRecord {
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

type ExperimentRunResultEvent = TargetResultEvent | EvaluatorResultEvent;

/**
 * Event handler that writes individual experiment run results to ClickHouse.
 * Triggered for each TargetResultEvent and EvaluatorResultEvent.
 *
 * This materializes a query-optimized read model (batch_evaluation_results) from the event stream,
 * following the CQRS pattern where event handlers maintain read models.
 *
 * Unlike projections which aggregate state, this handler writes denormalized rows
 * for efficient filtering/sorting of individual results.
 */
export class ExperimentRunResultStorageHandler
  implements EventHandler<ExperimentRunResultEvent>
{
  private readonly tracer = getLangWatchTracer(
    "langwatch.experiment-run-processing.result-storage-handler",
  );
  private readonly logger = createLogger(
    "langwatch:experiment-run-processing:result-storage-handler",
  );

  /**
   * Handles a result event by writing to batch_evaluation_results.
   *
   * @param event - The TargetResultEvent or EvaluatorResultEvent
   */
  async handle(event: ExperimentRunResultEvent): Promise<void> {
    return await this.tracer.withActiveSpan(
      "ExperimentRunResultStorageHandler.handle",
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

        let record: ClickHouseExperimentRunResultRecord;

        if (isTargetResultEvent(event)) {
          record = this.mapTargetResultToRecord(event);
          span.setAttributes({
            "result.type": "target",
            "result.index": event.data.index,
            "result.target_id": event.data.targetId,
          });
        } else if (isEvaluatorResultEvent(event)) {
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
          "Writing experiment run result to ClickHouse",
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
            "Successfully wrote experiment run result to ClickHouse",
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
            "Failed to write experiment run result to ClickHouse",
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
    event: TargetResultEvent,
  ): ClickHouseExperimentRunResultRecord {
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
    event: EvaluatorResultEvent,
  ): ClickHouseExperimentRunResultRecord {
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
    typeof TARGET_RESULT_EVENT_TYPE,
    typeof EVALUATOR_RESULT_EVENT_TYPE,
  ] {
    return [TARGET_RESULT_EVENT_TYPE, EVALUATOR_RESULT_EVENT_TYPE] as const;
  }

  /**
   * Returns data for display in debugging tools.
   */
  getDisplayData(event: ExperimentRunResultEvent) {
    if (isTargetResultEvent(event)) {
      return this.mapTargetResultToRecord(event);
    } else if (isEvaluatorResultEvent(event)) {
      return this.mapEvaluatorResultToRecord(event);
    }
    return null;
  }
}
