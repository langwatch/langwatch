import { DSPY_STEPS_INDEX, esClient } from "../../src/server/elasticsearch";
import { getCurrentWriteIndex } from "../helpers";

export const migrate = async () => {
  const currentIndex = await getCurrentWriteIndex({
    indexSpec: DSPY_STEPS_INDEX,
  });

  await esClient.indices.putMapping({
    index: currentIndex,
    properties: {
      workflow_version_id: {
        type: "keyword",
      },
    },
  });
};
