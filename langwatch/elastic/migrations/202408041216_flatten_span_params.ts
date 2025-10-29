import type { estypes } from "@elastic/elasticsearch";
import { TRACE_INDEX } from "../../src/server/elasticsearch";
import { recreateIndexAndMigrate } from "../helpers";
import { traceMapping } from "../schema";
import { type Client as ElasticClient } from "@elastic/elasticsearch";

type MappingProperty = estypes.MappingProperty;

export const migrate = async (migrationKey: string, client: ElasticClient) => {
  await recreateIndexAndMigrate({
    indexSpec: TRACE_INDEX,
    mapping: traceMapping as Record<string, MappingProperty>,
    migrationKey,
    client,
  });
};
