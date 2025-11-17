import { getClickHouseClient } from "../../../../utils/clickhouse";
import { TraceProjectionStoreClickHouse } from "./repositories/traceProjectionStoreClickHouse";
import { TraceProjectionStoreMemory } from "./repositories/traceProjectionStoreMemory";
import { SpanReadRepositoryClickHouse } from "./repositories/spanReadRepositoryClickHouse";
import { TraceProjectionEventHandler } from "./eventHandlers/traceProjectionEventHandler";
import type { SpanEvent, TraceProjection } from "./types";
import { eventSourcing } from "../../runtime";
import { TraceProcessingCommandHandler } from "./commandHandlers/traceProcessingCommandHandler";
import { SpanStoreClickHouse } from "../span-processing/repositories/spanStoreClickHouse";
import { SpanStoreMemory } from "../span-processing/repositories/spanStoreMemory";

const clickHouseClient = getClickHouseClient();

const projectionStore = clickHouseClient
  ? new TraceProjectionStoreClickHouse(clickHouseClient)
  : new TraceProjectionStoreMemory();

export const checkpointRepository = eventSourcing.getCheckpointRepository();

const spanReadRepository = clickHouseClient
  ? new SpanReadRepositoryClickHouse(clickHouseClient)
  : null;

const eventHandler = spanReadRepository
  ? new TraceProjectionEventHandler(spanReadRepository)
  : new TraceProjectionEventHandler({
      async getSpansForTrace() {
        return [];
      },
    });

export const traceProcessingPipeline = eventSourcing
  .registerPipeline<SpanEvent, TraceProjection>()
  .withName("trace-processing")
  .withAggregateType("trace")
  .withProjectionStore(projectionStore)
  .withEventHandler(eventHandler)
  .build();

const spanStore = clickHouseClient
  ? new SpanStoreClickHouse(clickHouseClient)
  : new SpanStoreMemory();

export const traceProcessingCommandHandler = new TraceProcessingCommandHandler(
  spanStore,
);
