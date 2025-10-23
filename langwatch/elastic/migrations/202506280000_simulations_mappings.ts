import type { estypes } from "@elastic/elasticsearch";
import { type Client as ElasticClient } from "@elastic/elasticsearch";
import { createIndex } from "../helpers";
import { eventMapping } from "../mappings/scenario-events";
import { SCENARIO_EVENTS_INDEX } from "../../src/server/elasticsearch";

type MappingProperty = estypes.MappingProperty;

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
