import { TraceProjectionConsumerBullMq } from "./traceProjectionConsumerBullMq";
import type { TraceProjectionConsumer } from "./traceProjectionConsumer";

export { TraceProjectionConsumerBullMq, type TraceProjectionConsumer };

// Create and export consumer instances
import { getClickHouseClient } from "../../../../utils/clickhouse";
import { EventStoreClickHouse } from "../repositories/eventStoreClickHouse";
import { EventStoreMemory } from "../repositories/eventStoreMemory";
import { ProjectionStoreClickHouse } from "../repositories/projectionStoreClickHouse";
import { ProjectionStoreMemory } from "../repositories/projectionStoreMemory";
import { TraceProjectionEventHandler } from "../eventHandlers/traceProjectionEventHandler";
import { createTraceProcessingService } from "../services/traceProcessingService";

const clickHouseClient = getClickHouseClient();
const eventStore = clickHouseClient
  ? new EventStoreClickHouse(clickHouseClient)
  : new EventStoreMemory();

const projectionStore = clickHouseClient
  ? new ProjectionStoreClickHouse(clickHouseClient)
  : new ProjectionStoreMemory();

const eventHandler = new TraceProjectionEventHandler();
const traceProcessingService = createTraceProcessingService({
  eventStore,
  projectionStore,
  eventHandler,
});

export const traceProjectionConsumerBullMq = clickHouseClient
  ? new TraceProjectionConsumerBullMq(traceProcessingService)
  : null;
