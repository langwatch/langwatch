import { TRACE_CHECKS_INDEX, esClient } from "../server/elasticsearch";

export const reindex = async () => {
  await esClient.reindex({
    body: {
      source: { index: TRACE_CHECKS_INDEX + "_temp" },
      dest: { index: TRACE_CHECKS_INDEX },
    },
  });
};

export default async function execute() {
  await reindex();
}
