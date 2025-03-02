import { esClient, TRACE_INDEX } from "../../src/server/elasticsearch";
import { getCurrentWriteIndex } from "../helpers";

export const migrate = async () => {
  const currentIndex = await getCurrentWriteIndex({
    indexSpec: TRACE_INDEX,
  });

  await esClient.indices.putMapping({
    index: currentIndex,
    properties: {
      retention_policy: { type: "keyword" },
      retention_holdouts: { type: "keyword" },
    },
  });
};
