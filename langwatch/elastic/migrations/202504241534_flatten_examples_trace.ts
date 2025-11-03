import type { MappingProperty } from "@elastic/elasticsearch/lib/api/types";
import { DSPY_STEPS_INDEX } from "../../src/server/elasticsearch";
import { recreateIndexAndMigrate } from "../helpers";
import { dspyStepsMapping } from "../schema";
import { type Client as ElasticClient } from "@elastic/elasticsearch";

export const migrate = async (migrationKey: string, client: ElasticClient) => {
  await recreateIndexAndMigrate({
    indexSpec: DSPY_STEPS_INDEX,
    mapping: dspyStepsMapping as Record<string, MappingProperty>,
    migrationKey,
    client,
  });
};
