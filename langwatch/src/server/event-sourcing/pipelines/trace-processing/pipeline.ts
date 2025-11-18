import { getClickHouseClient } from "../../../../utils/clickhouse";
import { TraceProjectionRepositoryClickHouse } from "./repositories/traceProjectionRepositoryClickHouse";
import { TraceProjectionRepositoryMemory } from "./repositories/traceProjectionRepositoryMemory";
import { SpanReadRepositoryClickHouse } from "./repositories/spanReadRepositoryClickHouse";
import { TraceProjectionEventHandler } from "./eventHandlers/traceProjectionEventHandler";
import type { SpanEvent, TraceProjection } from "./types";
import { eventSourcing } from "../../runtime";
import { TraceProcessingCommandHandler } from "./commandHandlers/traceProcessingCommandHandler";

const clickHouseClient = getClickHouseClient();

const projectionStore = clickHouseClient
  ? new TraceProjectionRepositoryClickHouse(clickHouseClient)
  : new TraceProjectionRepositoryMemory();

export const checkpointStore = eventSourcing.getCheckpointStore();

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

export const traceProcessingCommandHandler =
  new TraceProcessingCommandHandler();
