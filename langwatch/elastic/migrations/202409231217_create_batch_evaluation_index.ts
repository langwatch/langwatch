import type { MappingProperty } from "@elastic/elasticsearch/lib/api/types";
import {
  BATCH_EVALUATION_INDEX,
  esClient,
} from "../../src/server/elasticsearch";
import { createIndex } from "../helpers";
import { batchEvaluationMapping } from "../schema";

export const migrate = async () => {
  await createIndex({
    index: BATCH_EVALUATION_INDEX.base,
    mappings: batchEvaluationMapping as Record<string, MappingProperty>,
  });
  await esClient.indices.putAlias({
    index: BATCH_EVALUATION_INDEX.base,
    name: BATCH_EVALUATION_INDEX.alias,
    is_write_index: true,
  });
};
