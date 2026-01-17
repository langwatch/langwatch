import type { Client as ElasticClient } from "@elastic/elasticsearch";
import { TRACE_INDEX } from "../../src/server/elasticsearch";
import { getCurrentWriteIndex } from "../helpers";

export const migrate = async (_migrationKey: string, client: ElasticClient) => {
  const currentIndex = await getCurrentWriteIndex({
    indexSpec: TRACE_INDEX,
    client,
  });

  await client.indices.putMapping({
    index: currentIndex,
    properties: {
      evaluations: {
        type: "nested",
        properties: {
          label: {
            type: "keyword",
          },
        },
      },
    },
  });
};
