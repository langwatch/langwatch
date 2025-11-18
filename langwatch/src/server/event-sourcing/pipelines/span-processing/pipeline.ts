import type { StoreSpanIngestionCommandData } from "./types";
import { EventSourcedQueueProcessorImpl } from "../../runtime";
import { createCommand, createTenantId } from "../../library";
import { getClickHouseClient } from "../../../../utils/clickhouse";
import { SpanRepositoryClickHouse } from "./repositories/spanRepositoryClickHouse";
import { SpanRepositoryMemory } from "./repositories/spanRepositoryMemory";
import { SpanIngestionRecordCommandHandler } from "./commandHandlers/spanIngestionStoreCommandHandler";
import { eventSourcing } from "../../runtime";
import type { SpanEvent } from "./types/spanEvent";
import type { Projection } from "../../library";
import { SpanProjectionStoreMemory } from "./projectionStores/spanProjectionStoreMemory";
import { SpanProjectionEventHandler } from "./eventHandlers/spanProjectionEventHandler";

export const SPAN_INGESTION_RECORD_COMMAND_QUEUE =
  "{span_ingestion_record_command}";
export const SPAN_INGESTION_RECORD_COMMAND_NAME =
  "span_ingestion_record_command";

const clickHouseClient = getClickHouseClient();
const spanRepository = clickHouseClient
  ? new SpanRepositoryClickHouse(clickHouseClient)
  : new SpanRepositoryMemory();

const spanIngestionRecordCommandHandler = new SpanIngestionRecordCommandHandler(
  spanRepository,
);

const projectionStore = new SpanProjectionStoreMemory();
const eventHandler = new SpanProjectionEventHandler();

export const spanProcessingPipeline = eventSourcing
  .registerPipeline<SpanEvent, Projection<string>>()
  .withName("span-processing")
  .withAggregateType("span")
  .withProjectionStore(projectionStore)
  .withEventHandler(eventHandler)
  .build();

export const spanIngestionRecordCommandDispatcher =
  new EventSourcedQueueProcessorImpl<StoreSpanIngestionCommandData>({
    queueName: SPAN_INGESTION_RECORD_COMMAND_QUEUE,
    jobName: SPAN_INGESTION_RECORD_COMMAND_NAME,
    makeJobId: (command) => `${command.tenantId}:${command.spanData.traceId}`,
    delay: 100,
    spanAttributes: (command) => ({
      "payload.trace.id": command.spanData.traceId,
      "payload.span.id": command.spanData.spanId,
    }),
    async process(command) {
      const recordCommand = createCommand(
        createTenantId(command.tenantId),
        `${command.spanData.traceId}/${command.spanData.spanId}`,
        "lw.obs.span.ingestion.record",
        command,
      );
      await spanIngestionRecordCommandHandler.handle(recordCommand);
    },
  });
