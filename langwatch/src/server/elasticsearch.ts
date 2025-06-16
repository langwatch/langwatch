import { Client as ElasticClient } from "@elastic/elasticsearch";
import { Client as OpenSearchClient } from "@opensearch-project/opensearch";

import { env } from "../env.mjs";
import { patchForOpensearchCompatibility } from "./elasticsearch/patchOpensearchCompatibility";
import { patchForQuickwitCompatibility } from "./elasticsearch/patchQuickwitCompatibility";
import { prisma } from "./db";
import { decrypt } from "../utils/encryption";
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

export const esClient = async (
  args: { projectId: string } | { organizationId: string } | { test: true }
) => {
  let elasticsearchNodeUrl: string | null = null;
  let elasticsearchApiKey: string | null = null;

  if ("test" in args) {
    // For tests, directly use environment variables
    elasticsearchNodeUrl = env.ELASTICSEARCH_NODE_URL ?? null;
    elasticsearchApiKey = env.ELASTICSEARCH_API_KEY ?? null;
  } else {
    // For non-test cases, check org-specific settings first
    let orgElasticsearchNodeUrl: string | null = null;
    let orgElasticsearchApiKey: string | null = null;

    if ("organizationId" in args) {
      const organization = await prisma.organization.findUnique({
        where: { id: args.organizationId },
      });
      orgElasticsearchNodeUrl = organization?.elasticsearchNodeUrl
        ? decrypt(organization.elasticsearchNodeUrl)
        : null;
      orgElasticsearchApiKey = organization?.elasticsearchApiKey
        ? decrypt(organization.elasticsearchApiKey)
        : null;
    } else if ("projectId" in args) {
      const project = await getOrgElasticsearchDetailsFromProject(
        args.projectId
      );
      orgElasticsearchNodeUrl = project?.elasticsearchNodeUrl
        ? decrypt(project.elasticsearchNodeUrl)
        : null;
      orgElasticsearchApiKey = project?.elasticsearchApiKey
        ? decrypt(project.elasticsearchApiKey)
        : null;
    }

    // Use org settings if available, otherwise fall back to env vars
    const useOrgSettings = orgElasticsearchNodeUrl && orgElasticsearchApiKey;
    elasticsearchNodeUrl = useOrgSettings
      ? orgElasticsearchNodeUrl
      : env.ELASTICSEARCH_NODE_URL ?? null;
    elasticsearchApiKey = useOrgSettings
      ? orgElasticsearchApiKey
      : env.ELASTICSEARCH_API_KEY ?? null;
  }

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
