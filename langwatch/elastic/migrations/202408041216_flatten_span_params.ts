import type { MappingProperty } from "@elastic/elasticsearch/lib/api/types";
import { TRACE_INDEX } from "../../src/server/elasticsearch";
import { recreateIndexAndMigrate } from "../helpers";
import { traceMapping } from "../schema";

export const migrate = async (migrationId: string) => {
  await recreateIndexAndMigrate({
    index: TRACE_INDEX,
    mapping: traceMapping as Record<string, MappingProperty>,
    migrationId,
  });
};
