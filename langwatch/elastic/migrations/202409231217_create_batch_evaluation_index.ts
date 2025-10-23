import { BATCH_EVALUATION_INDEX } from "../../src/server/elasticsearch";
import { createIndex } from "../helpers";
import { batchEvaluationMapping } from "../schema";
import type { estypes } from "@elastic/elasticsearch";
import { type Client as ElasticClient } from "@elastic/elasticsearch";

type MappingProperty = estypes.MappingProperty;
export const migrate = async (_migrationKey: string, client: ElasticClient) => {
  await createIndex({
    index: BATCH_EVALUATION_INDEX.base,
    mappings: batchEvaluationMapping as Record<string, MappingProperty>,
    client,
  });

  await client.indices.putAlias({
    index: BATCH_EVALUATION_INDEX.base,
    name: BATCH_EVALUATION_INDEX.alias,
    is_write_index: true,
  });
};
