import { Client as ElasticClient } from "@elastic/elasticsearch";
import { Client as OpenSearchClient } from "@opensearch-project/opensearch";

import { env } from "../env.mjs";
import { patchForOpensearchCompatibility } from "./elasticsearch/opensearchCompatibility";
import { patchForQuickwitCompatibility } from "./elasticsearch/quickwitCompatibility";

import { prisma } from "./db";
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

const getOrgElasticsearchDetailsFromProject = async (projectId: string) => {
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    include: { team: { include: { organization: true } } },
  });

  return project?.team.organization ?? null;
};

export const esClient = async (organizationId?: string, projectId?: string) => {
  let orgElasticsearchNodeUrl: string | null = null;
  let orgElasticsearchApiKey: string | null = null;

  console.log("organizationId", organizationId);
  console.log("projectId", projectId);

  if (organizationId) {
    const organization = await prisma.organization.findUnique({
      where: { id: organizationId },
    });

    console.log("organization", organization);

    orgElasticsearchNodeUrl = organization?.elasticsearchNodeUrl ?? null;
    orgElasticsearchApiKey = organization?.elasticsearchApiKey ?? null;
    console.log("Using organization elasticsearch details", {
      orgElasticsearchNodeUrl,
      orgElasticsearchApiKey,
    });
  } else if (projectId) {
    const project = await getOrgElasticsearchDetailsFromProject(projectId);
    orgElasticsearchNodeUrl = project?.elasticsearchNodeUrl ?? null;
    orgElasticsearchApiKey = project?.elasticsearchApiKey ?? null;
    console.log("Using project elasticsearch details", {
      orgElasticsearchNodeUrl,
      orgElasticsearchApiKey,
    });
  }

  const useOrgSettings = orgElasticsearchNodeUrl && orgElasticsearchApiKey;

  const elasticsearchNodeUrl = useOrgSettings
    ? orgElasticsearchNodeUrl
    : env.ELASTICSEARCH_NODE_URL;
  const elasticsearchApiKey = useOrgSettings
    ? orgElasticsearchApiKey
    : env.ELASTICSEARCH_API_KEY;

  const client =
    !!env.IS_OPENSEARCH || !!env.IS_QUICKWIT
      ? (new OpenSearchClient({
          node: elasticsearchNodeUrl?.replace("quickwit://", "http://"),
        }) as unknown as ElasticClient)
      : new ElasticClient({
          node: elasticsearchNodeUrl ?? "http://bogus:9200",
          ...(elasticsearchApiKey
            ? {
                auth: {
                  apiKey: elasticsearchApiKey,
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

export const FLATENNED_TYPE = env.IS_OPENSEARCH ? "flat_object" : "flattened";

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
