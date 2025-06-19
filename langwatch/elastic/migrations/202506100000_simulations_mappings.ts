import type { MappingProperty } from "@elastic/elasticsearch/lib/api/types";
import { Client as ElasticClient } from "@elastic/elasticsearch";
import { createIndex } from "../helpers";
import { eventMapping } from "../mappings/scenario-events";

export const migrate = async (_migrationKey: string, client: ElasticClient) => {
  await createIndex({
    index: "scenario-events",
    mappings: eventMapping.properties as Record<string, MappingProperty>,
    client,
  });
};
