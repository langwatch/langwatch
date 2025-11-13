import { getClickHouseClient } from "../../../../utils/clickhouse";
import { SpanIngestionWriteRepositoryClickHouse } from "../repositories/spanIngestionWriteRepositoryClickHouse";
import { SpanIngestionWriteConsumerBullMq } from "./spanIngestionWriteConsumerBullMq";
import { SpanIngestionWriteRepositoryMemory } from "../repositories/spanIngestionWriteRepositoryMemory";

export type { SpanIngestionWriteConsumer } from "./spanIngestionWriteConsumer";
export { SpanIngestionWriteConsumerBullMq } from "./spanIngestionWriteConsumerBullMq";

// Create and export the ClickHouse consumer instance
const clickHouseClient = getClickHouseClient();
const spanIngestionWriteRepositoryClickHouse = clickHouseClient
  ? new SpanIngestionWriteRepositoryClickHouse(clickHouseClient)
  : new SpanIngestionWriteRepositoryMemory();

export const spanIngestionWriteConsumerClickHouse =
  new SpanIngestionWriteConsumerBullMq(spanIngestionWriteRepositoryClickHouse);
