import {
  esClient,
  BATCH_EVALUATION_INDEX,
  FLATENNED_TYPE,
} from "../../src/server/elasticsearch";
import { getCurrentWriteIndex } from "../helpers";

import { Client as ElasticClient } from "@elastic/elasticsearch";

export const migrate = async (_migrationKey: string, client: ElasticClient) => {
  const currentIndex = await getCurrentWriteIndex({
    indexSpec: BATCH_EVALUATION_INDEX,
  });

  await client.indices.putMapping({
    index: currentIndex,
    properties: {
      dataset: {
        properties: {
          predicted: {
            type: FLATENNED_TYPE,
          } as any,
        },
      },
    },
  });
};
