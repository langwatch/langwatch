import { DSPY_STEPS_INDEX, esClient } from "../../src/server/elasticsearch";
import { getCurrentWriteIndex } from "../helpers";

import { Client as ElasticClient } from "@elastic/elasticsearch";

export const migrate = async (_migrationKey: string, client: ElasticClient) => {
  const currentIndex = await getCurrentWriteIndex({
    indexSpec: DSPY_STEPS_INDEX,
  });

  await client.indices.putMapping({
    index: currentIndex,
    properties: {
      workflow_version_id: {
        type: "keyword",
      },
    },
  });
};
