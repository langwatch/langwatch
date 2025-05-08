import type { MappingProperty } from "@elastic/elasticsearch/lib/api/types";
import { TRACE_INDEX } from "../../src/server/elasticsearch";
import { recreateIndexAndMigrate } from "../helpers";
import { traceMapping } from "../schema";
import { type Client as ElasticClient } from "@elastic/elasticsearch";

export const migrate = async (migrationKey: string, client: ElasticClient) => {
  await recreateIndexAndMigrate({
    indexSpec: TRACE_INDEX,
    mapping: traceMapping as Record<string, MappingProperty>,
    migrationKey,
    client,
  });
};
