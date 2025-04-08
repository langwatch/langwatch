import { TRACE_INDEX, esClient } from "../server/elasticsearch";

const ONE_YEAR_MS = 365 * 24 * 60 * 60 * 1000;
const RETENTION_PERIODS: Record<string, number> = {
  "180d": 180 * 24 * 60 * 60 * 1000,
  "365d": 365 * 24 * 60 * 60 * 1000,
  "730d": 730 * 24 * 60 * 60 * 1000,
};

const buildRetentionQuery = ({
  cutoff,
  projectId,
  retentionPolicy,
}: {
  cutoff: number;
  projectId?: string;
  retentionPolicy?: string;
}): Record<string, any> => ({
  bool: {
    must: [
      {
        range: {
          "timestamps.inserted_at": {
            lt: cutoff,
          },
        },
      },
      ...(projectId ? [{ term: { project_id: projectId } }] : []),
      ...(retentionPolicy
        ? [{ term: { retention_policy: retentionPolicy } }]
        : []),
    ],
    must_not: [
      {
        exists: {
          field: "retention_holdouts",
        },
      },
      ...(!retentionPolicy
        ? [
            {
              exists: {
                field: "retention_policy",
              },
            },
          ]
        : []),
    ],
  },
});

export const deleteTracesRetentionPolicy = async (projectId?: string) => {
  const now = Date.now();
  const defaultCutoff = now - ONE_YEAR_MS;
  let totalDeleted = 0;

  // 1. Delete traces with specific retention policies
  for (const [policy, retentionMs] of Object.entries(RETENTION_PERIODS)) {
    const cutoff = now - retentionMs;
    const query = buildRetentionQuery({
      cutoff,
      projectId,
      retentionPolicy: policy,
    });

    const client = await esClient({ projectId: projectId ?? "" });
    const response = await client.deleteByQuery({
      index: TRACE_INDEX.alias,
      refresh: true,
      body: { query },
    });

    totalDeleted += response.deleted ?? 0;
    console.log(
      `Deleted ${response.deleted} traces with retention policy ${policy}`
    );
  }

  // 2. Delete traces without retention policy (default 1 year)
  const query = buildRetentionQuery({ cutoff: defaultCutoff, projectId });
  const client = await esClient({ projectId: projectId ?? "" });
  const response = await client.deleteByQuery({
    index: TRACE_INDEX.alias,
    refresh: true,
    body: { query },
  });

  totalDeleted += response.deleted ?? 0;
  console.log(
    `Deleted ${response.deleted} traces with default retention policy (1 year)`
  );

  return totalDeleted;
};

export default async function execute(projectId?: string) {
  await deleteTracesRetentionPolicy(projectId);
}
