import { SpanKind } from "@opentelemetry/api";
import { getLangWatchTracer } from "langwatch";

import type { Command, CommandHandler } from "../../../library";
import type { StoreSpanIngestionCommandData } from "../types";
import { createCommand, createTenantId } from "../../../library";
import { spanProcessingPipeline } from "../pipeline";
import { traceProcessingCommandHandler } from "../../trace-processing/pipeline";
import type { SpanIngestionEvent } from "../types/spanEvent";
import type { RebuildTraceProjectionCommand } from "../../trace-processing/commands/traceProcessingCommand";
import type { SpanRepository } from "../repositories/spanRepository";
import { createLogger } from "../../../../../utils/logger";

/**
 * Command handler for span ingestion record commands.
 * Writes spans to persistent storage, stores ingestion events, and dispatches trace processing.
 */
export class SpanIngestionRecordCommandHandler
  implements
    CommandHandler<string, Command<string, StoreSpanIngestionCommandData>>
{
  tracer = getLangWatchTracer(
    "langwatch.span-ingestion-record.command-handler",
  );
  logger = createLogger("langwatch:span-ingestion-record:command-handler");

  constructor(private readonly spanRepository: SpanRepository) {}

  async handle(
    command: Command<string, StoreSpanIngestionCommandData>,
  ): Promise<void> {
    return await this.tracer.withActiveSpan(
      "SpanIngestionRecordCommandHandler.handle",
      {
        kind: SpanKind.INTERNAL,
        attributes: {
          "command.type": command.type,
          "command.aggregate_id": command.aggregateId,
          "tenant.id": command.tenantId,
        },
      },
      async () => {
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
          "Handling span ingestion record command",
        );

        // Write span to persistent storage
        await this.spanRepository.insertSpan({
          ...commandData,
          tenantId,
        });

        const aggregateId = `${traceId}/${spanId}`;
        const ingestionEvent: SpanIngestionEvent = {
          aggregateId,
          tenantId,
          timestamp: collectedAtUnixMs,
          type: "lw.obs.span.ingestion.recorded",
          data: {
            traceId,
            spanId,
            collectedAtUnixMs,
          },
          metadata: {
            spanId,
            collectedAtUnixMs,
          },
        };

        await spanProcessingPipeline.service.storeEvents([ingestionEvent], {
          tenantId,
        });

        // Dispatch trace processing command
        const rebuildCommand = createCommand(
          createTenantId(tenantId),
          traceId,
          "lw.obs.trace.projection.rebuild",
          {
            traceId,
            spanId,
          },
        ) as RebuildTraceProjectionCommand;

        await traceProcessingCommandHandler.handle(rebuildCommand);
      },
    );
  }
}
