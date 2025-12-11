export type { SpanProjectionStore } from "./spanProjectionStore";
export { SpanProjectionStoreClickHouse } from "./spanProjectionStoreClickHouse";
export { SpanProjectionStoreMemory } from "./spanProjectionStoreMemory";

import { getClickHouseClient } from "~/server/clickhouse/client";
import type { SpanProjectionStore } from "./spanProjectionStore";
import { SpanProjectionStoreClickHouse } from "./spanProjectionStoreClickHouse";
import { SpanProjectionStoreMemory } from "./spanProjectionStoreMemory";

const clickHouseClient = getClickHouseClient();

export const spanProjectionStore: SpanProjectionStore = clickHouseClient
  ? new SpanProjectionStoreClickHouse(clickHouseClient)
  : new SpanProjectionStoreMemory();

