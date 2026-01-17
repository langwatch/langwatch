import type { Client as ElasticClient } from "@elastic/elasticsearch";
import type { MappingProperty } from "@elastic/elasticsearch/lib/api/types";
import { SCENARIO_EVENTS_INDEX } from "../../src/server/elasticsearch";
import { createIndex } from "../helpers";
import { eventMapping } from "../mappings/scenario-events";

export const migrate = async (_migrationKey: string, client: ElasticClient) => {
  await createIndex({
    index: SCENARIO_EVENTS_INDEX.base,
    mappings: eventMapping.properties as Record<string, MappingProperty>,
    client,
  });
  await client.indices.putAlias({
    index: SCENARIO_EVENTS_INDEX.base,
    name: SCENARIO_EVENTS_INDEX.alias,
    is_write_index: true,
  });
};
