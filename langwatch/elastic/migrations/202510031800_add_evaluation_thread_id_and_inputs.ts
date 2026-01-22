import type { Client as ElasticClient } from "@elastic/elasticsearch";
import { FLATENNED_TYPE, TRACE_INDEX } from "../../src/server/elasticsearch";
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
          evaluation_thread_id: {
            type: "keyword",
          },
          inputs: {
            type: FLATENNED_TYPE,
          } as any,
        },
      },
    },
  });

  console.log(
    "✓ Added evaluation_thread_id (keyword) and inputs fields to evaluations",
  );
};
