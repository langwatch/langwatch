import { Client as ElasticClient } from "@elastic/elasticsearch";
import { Client as OpenSearchClient } from "@opensearch-project/opensearch";

import { env } from "../env.mjs";
import { patchForOpensearchCompatibility } from "./elasticsearch/opensearchCompatibility";
import { patchForQuickwitCompatibility } from "./elasticsearch/quickwitCompatibility";

import { getServerSession } from "next-auth";
import { authOptions } from "./auth";

export type IndexSpec = {
  alias: string;
  base: string;
};

export const MIGRATION_INDEX = "search-elastic-migrations";

export const TRACE_INDEX: IndexSpec = {
  base: "search-traces",
  alias: "search-traces-alias",
};

export const DSPY_STEPS_INDEX: IndexSpec = {
  base: "search-dspy-steps",
  alias: "search-dspy-steps-alias",
};

export const BATCH_EVALUATION_INDEX: IndexSpec = {
  base: "search-batch-evaluations",
  alias: "search-batch-evaluations-alias",
};

export const esClient = async () => {
  const session = await getServerSession(authOptions);
  console.log("Session in server component:", session);

  // Create a client with session context if needed
  const client =
    !!env.IS_OPENSEARCH || !!env.IS_QUICKWIT
      ? (new OpenSearchClient({
          node: env.ELASTICSEARCH_NODE_URL?.replace("quickwit://", "http://"),
        }) as unknown as ElasticClient)
      : new ElasticClient({
          node: env.ELASTICSEARCH_NODE_URL ?? "http://bogus:9200",
          ...(env.ELASTICSEARCH_API_KEY
            ? {
                auth: {
                  apiKey: env.ELASTICSEARCH_API_KEY,
                },
              }
            : {}),
        });

  // Apply patches to this specific client instance
  if (env.IS_OPENSEARCH) {
    patchForOpensearchCompatibility(client);
  }

  if (env.IS_QUICKWIT) {
    patchForOpensearchCompatibility(client);
    patchForQuickwitCompatibility(client);
  }

  return client;
};

// export const esClient =
//   !!env.IS_OPENSEARCH || !!env.IS_QUICKWIT
//     ? (new OpenSearchClient({
//         node: env.ELASTICSEARCH_NODE_URL?.replace("quickwit://", "http://"),
//       }) as unknown as ElasticClient)
//     : new ElasticClient({
//         node: env.ELASTICSEARCH_NODE_URL ?? "http://bogus:9200",
//         ...(env.ELASTICSEARCH_API_KEY
//           ? {
//               auth: {
//                 apiKey: env.ELASTICSEARCH_API_KEY,
//               },
//             }
//           : {}),
//       });

export const FLATENNED_TYPE = env.IS_OPENSEARCH ? "flat_object" : "flattened";

if (env.IS_OPENSEARCH) {
  patchForOpensearchCompatibility(esClient);
}

if (env.IS_QUICKWIT) {
  patchForOpensearchCompatibility(esClient);
  patchForQuickwitCompatibility(esClient);
}

export const traceIndexId = ({
  traceId,
  projectId,
}: {
  traceId: string;
  projectId: string;
}) => `${projectId}/${traceId}`;

export const spanIndexId = ({
  spanId,
  projectId,
}: {
  spanId: string;
  projectId: string;
}) => `${projectId}/${spanId}`;

export const traceCheckIndexId = ({
  traceId,
  checkId,
  projectId,
}: {
  traceId: string;
  checkId: string;
  projectId: string;
}) => `${projectId}/${traceId}/${checkId}`;

export const eventIndexId = ({
  eventId,
  projectId,
}: {
  eventId: string;
  projectId: string;
}) => `${projectId}/${eventId}`;

export const dspyStepIndexId = ({
  projectId,
  runId,
  index,
}: {
  projectId: string;
  runId: string;
  index: string;
}) => `${projectId}/${runId}/${index}`;

export const batchEvaluationId = ({
  projectId,
  experimentId,
  runId,
}: {
  projectId: string;
  experimentId: string;
  runId: string;
}) => `${projectId}/${experimentId}/${runId}`;
