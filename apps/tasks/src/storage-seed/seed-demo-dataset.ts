import type { Dataset, DatasetApi, DatasetColumns } from "@langwatch/dataset-contract";

const DATASET_NAME = "Support Regression Cases";

/** The slug the name derives, then the one a seed before object storage wrote. */
const SEEDED_SLUGS = ["support-regression-cases", "demo-support-regression"] as const;

const DATASET_COLUMNS: DatasetColumns = [
  { name: "input", type: "string" },
  { name: "expected_output", type: "string" },
  { name: "category", type: "string" },
];

const DATASET_ROWS = [
  {
    input: "I was charged twice for my Pro subscription. Please fix it.",
    expected_output:
      "Acknowledge the duplicate charge, explain the refund timeline, and avoid claiming a refund already happened.",
    category: "billing",
  },
  {
    input: "How can I invite five teammates and choose their roles?",
    expected_output:
      "Direct the user to Settings > Members, explain bulk invitations, and mention role selection.",
    category: "onboarding",
  },
  {
    input: "What happens when the traces API rate limit is exceeded?",
    expected_output:
      "Explain HTTP 429, Retry-After, and exponential backoff without inventing a numeric limit.",
    category: "documentation",
  },
  {
    input: "Checkout returned 500s after a deploy. Summarize the incident.",
    expected_output:
      "State the customer impact, the rollback recovery, the missing environment variable, and a prevention action.",
    category: "incident",
  },
  {
    input: "A customer asks for a refund outside policy and is angry.",
    expected_output:
      "Stay empathetic, explain the policy, and escalate to a human without promising an exception.",
    category: "escalation",
  },
];

/**
 * The demo platform's sample dataset, created through the dataset module so its rows are born in
 * object storage. A dataset an earlier run seeded is kept as it is: the dataset module's content
 * move takes one still in the records table.
 */
export async function seedDemoDataset({
  datasets,
  projectId,
}: {
  datasets: DatasetApi;
  projectId: string;
}): Promise<Dataset> {
  for (const slugOrId of SEEDED_SLUGS) {
    const seeded = await datasets.findBySlugOrId({ projectId, slugOrId });
    if (seeded) return seeded;
  }

  return datasets.upsertDataset({
    projectId,
    name: DATASET_NAME,
    columnTypes: DATASET_COLUMNS,
    datasetRecords: DATASET_ROWS.map((entry, index) => ({
      ...entry,
      id: `demo-dataset-record-${index + 1}`,
    })),
  });
}
