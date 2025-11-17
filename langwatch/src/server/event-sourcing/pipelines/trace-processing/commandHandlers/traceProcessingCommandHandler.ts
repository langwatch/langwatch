import { SpanKind } from "@opentelemetry/api";
import { getLangWatchTracer } from "langwatch";

import type { Command, CommandHandler } from "../../../library";
import type {
  TraceProcessingCommand,
  RebuildTraceProjectionCommand,
  ForceRebuildTraceProjectionCommand,
  BulkRebuildTraceProjectionsCommand,
  RecordSpanProcessingCommand,
} from "../commands/traceProcessingCommand";
import { traceProcessingPipeline } from "../pipeline";
import type { SpanEvent } from "../types";
import type { SpanStore } from "../../span-processing/repositories/spanStore";
import { createLogger } from "../../../../../utils/logger";

/**
 * Command handler for trace processing commands.
 * Receives commands, validates them, and delegates to the trace processing service.
 */
export class TraceProcessingCommandHandler
  implements CommandHandler<string, TraceProcessingCommand>
{
  tracer = getLangWatchTracer("langwatch.trace-processing.command-handler");
  logger = createLogger("langwatch:trace-processing:command-handler");

  constructor(private readonly spanStore: SpanStore) {}

  async handle(command: TraceProcessingCommand): Promise<void> {
    return await this.tracer.withActiveSpan(
      "TraceProcessingCommandHandler.handle",
      {
        kind: SpanKind.INTERNAL,
        attributes: {
          "command.type": command.type,
          "command.aggregate_id": String(command.aggregateId),
          "tenant.id": command.tenantId,
        },
      },
      async () => {
        // All commands extend Command, so they have aggregateId and data
        const cmd = command as Command<string, unknown>;

        switch (command.type) {
          case "trace.rebuild_projection":
            return await this.handleRebuildProjection(command);
          case "trace.force_rebuild":
            return await this.handleForceRebuild(command);
          case "trace.bulk_rebuild":
            return await this.handleBulkRebuild(command);
          case "trace.record_span_ingestion":
            return await this.handleRecordSpanIngestion(command);
          default:
            throw new Error(`Unknown command type: ${cmd.type}`);
        }
      },
    );
  }

  private async handleRebuildProjection(
    command: RebuildTraceProjectionCommand,
  ): Promise<void> {
    const { traceId, force } = command.data;
    const tenantId = command.tenantId;

    this.logger.info(
      {
        tenantId,
        traceId,
        force: force ?? false,
      },
      "Handling rebuild projection command",
    );

    if (force) {
      await traceProcessingPipeline.service.forceRebuildProjection(traceId, {
        eventStoreContext: { tenantId },
        projectionStoreContext: { tenantId },
      });
    } else {
      await traceProcessingPipeline.service.rebuildProjection(traceId, {
        eventStoreContext: { tenantId },
        projectionStoreContext: { tenantId },
      });
    }
  }

  private async handleForceRebuild(
    command: ForceRebuildTraceProjectionCommand,
  ): Promise<void> {
    const { traceId } = command.data;
    const tenantId = command.tenantId;

    this.logger.info(
      {
        tenantId,
        traceId,
      },
      "Handling force rebuild command",
    );

    await traceProcessingPipeline.service.forceRebuildProjection(traceId, {
      eventStoreContext: { tenantId },
      projectionStoreContext: { tenantId },
    });
  }

  private async handleBulkRebuild(
    command: BulkRebuildTraceProjectionsCommand,
  ): Promise<void> {
    const { batchSize, cursor, resumeFromCount } = command.data;
    const tenantId = command.tenantId;

    this.logger.info(
      {
        tenantId,
        batchSize: batchSize ?? "default",
        cursor: cursor ?? "none",
        resumeFromCount: resumeFromCount ?? 0,
      },
      "Handling bulk rebuild command",
    );

    await traceProcessingPipeline.service.rebuildProjectionsInBatches({
      batchSize,
      eventStoreContext: { tenantId },
      projectionStoreContext: { tenantId },
      resumeFrom: cursor
        ? {
            cursor,
            processedCount: resumeFromCount ?? 0,
          }
        : void 0,
    });
  }

  private async handleRecordSpanIngestion(
    command: RecordSpanProcessingCommand,
  ): Promise<void> {
    const commandData = command.data;
    const { spanData, collectedAtUnixMs } = commandData;
    const tenantId = command.tenantId;
    const traceId = spanData.traceId;
    const spanId = spanData.spanId;

    this.logger.info(
      {
        tenantId,
        traceId,
        spanId,
        collectedAtUnixMs,
      },
      "Handling record span ingestion command",
    );

    await this.spanStore.insertSpan({
      ...commandData,
      tenantId,
    });

    const ingestionEvent: SpanEvent = {
      aggregateId: traceId,
      timestamp: collectedAtUnixMs,
      type: "span.ingestion.ingested",
      data: {
        traceId,
        spanId,
        collectedAtUnixMs,
      },
      metadata: {
        tenantId,
        spanId,
        collectedAtUnixMs,
      },
    };

    await traceProcessingPipeline.service.storeEvents([ingestionEvent], {
      tenantId,
    });

    await traceProcessingPipeline.service.rebuildProjection(traceId, {
      eventStoreContext: { tenantId },
      projectionStoreContext: { tenantId },
    });
  }
}
