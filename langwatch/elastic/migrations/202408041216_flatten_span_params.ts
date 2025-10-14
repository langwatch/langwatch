import { type Client as ElasticClient, estypes } from "@elastic/elasticsearch";
import { TRACE_INDEX } from "../../src/server/elasticsearch";
import { recreateIndexAndMigrate } from "../helpers";
import { traceMapping } from "../schema";

export const migrate = async (migrationKey: string, client: ElasticClient) => {
  await recreateIndexAndMigrate({
    indexSpec: TRACE_INDEX,
    mapping: traceMapping as Record<string, estypes.MappingProperty>,
    migrationKey,
    client,
  });
};
