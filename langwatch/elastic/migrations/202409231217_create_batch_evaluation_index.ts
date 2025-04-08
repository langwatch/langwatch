import type { MappingProperty } from "@elastic/elasticsearch/lib/api/types";
import {
  BATCH_EVALUATION_INDEX,
  esClient,
} from "../../src/server/elasticsearch";
import { createIndex } from "../helpers";
import { batchEvaluationMapping } from "../schema";

import { Client as ElasticClient } from "@elastic/elasticsearch";

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
