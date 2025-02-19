import {
  esClient,
  BATCH_EVALUATION_INDEX,
  FLATENNED_TYPE,
} from "../../src/server/elasticsearch";
import { getCurrentWriteIndex } from "../helpers";

export const migrate = async () => {
  const currentIndex = await getCurrentWriteIndex({
    indexSpec: BATCH_EVALUATION_INDEX,
  });

  await esClient.indices.putMapping({
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
