import type { Client as ElasticClient } from "@elastic/elasticsearch";
import type { MappingProperty } from "@elastic/elasticsearch/lib/api/types";
import { BATCH_EVALUATION_INDEX } from "../../src/server/elasticsearch";
import { recreateIndexAndMigrate } from "../helpers";
import { batchEvaluationMapping } from "../schema";

export const migrate = async (migrationKey: string, client: ElasticClient) => {
  await recreateIndexAndMigrate({
    indexSpec: BATCH_EVALUATION_INDEX,
    mapping: batchEvaluationMapping as Record<string, MappingProperty>,
    migrationKey,
    client,
  });
};
