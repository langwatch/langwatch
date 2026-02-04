import type { Client as ElasticClient } from "@elastic/elasticsearch";
import { BATCH_EVALUATION_INDEX } from "../../src/server/elasticsearch";
import { getCurrentWriteIndex } from "../helpers";

export const migrate = async (_migrationKey: string, client: ElasticClient) => {
  const currentIndex = await getCurrentWriteIndex({
    indexSpec: BATCH_EVALUATION_INDEX,
    client,
  });

  await client.indices.putMapping({
    index: currentIndex,
    properties: {
      targets: {
        type: "nested",
        properties: {
          evaluator_id: {
            type: "keyword",
          },
        },
      },
    },
  });
};
