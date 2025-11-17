import type { RecordSpanProcessingCommandData } from "./types";
import { EventSourcedQueueProcessorImpl } from "../../runtime";
import { createCommand, createTenantId } from "../../library";
import { traceProcessingCommandHandler } from "../trace-processing/pipeline";
import type { RecordSpanProcessingCommand } from "../trace-processing/commands/traceProcessingCommand";

export const SPAN_PROCESSING_COMMAND_QUEUE = "{span_processing_command}";
export const SPAN_PROCESSING_COMMAND_NAME = "span_processing_command";

/**
 * Queue processor payload that includes tenantId for queue operations.
 * The tenantId is extracted when creating the Command and not included in the command data.
 */
interface SpanProcessingQueuePayload extends RecordSpanProcessingCommandData {
  tenantId: string;
}

export const spanProcessingCommandDispatcher =
  new EventSourcedQueueProcessorImpl<SpanProcessingQueuePayload>({
    queueName: SPAN_PROCESSING_COMMAND_QUEUE,
    jobName: SPAN_PROCESSING_COMMAND_NAME,
    makeJobId: (command) => `${command.tenantId}:${command.spanData.traceId}`,
    spanAttributes: (command) => ({
      "payload.trace.id": command.spanData.traceId,
      "payload.span.id": command.spanData.spanId,
    }),
    async process(command) {
      const { tenantId, ...commandData } = command;
      const recordCommand = createCommand(
        createTenantId(tenantId),
        command.spanData.traceId,
        "trace.record_span_ingestion",
        commandData,
      ) as RecordSpanProcessingCommand;
      await traceProcessingCommandHandler.handle(recordCommand);
    },
  });
