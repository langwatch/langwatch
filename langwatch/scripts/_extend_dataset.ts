/** Dogfood helper: grow lively-glad-wave to 6 rows and clear stale results. */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const EXTRA_ROWS = [
  {
    input: "Can I get a refund for last month?",
    expected_output:
      "Refunds for the previous billing period are available within 30 days. I can start that for you right now — just confirm the charge you'd like refunded.",
  },
  {
    input: "How do I invite a teammate?",
    expected_output:
      "Go to Settings > Members and click 'Invite'. Enter their email and pick a role. They'll get an invite link that's valid for 7 days.",
  },
  {
    input: "Is my data encrypted?",
    expected_output:
      "Yes. Data is encrypted in transit with TLS 1.3 and at rest with AES-256. You can read the full details in our security whitepaper.",
  },
];

async function main() {
  const project = await prisma.project.findFirst({ where: { slug: "d-1h5icu" } });
  if (!project) throw new Error("project d-1h5icu not found");

  const experiment = await prisma.experiment.findFirst({
    where: { projectId: project.id, slug: "lively-glad-wave" },
  });
  if (!experiment) throw new Error("experiment lively-glad-wave not found");

  const state = experiment.workbenchState as Record<string, any>;
  const dataset = state.datasets?.[0];
  if (!dataset?.inline?.records) throw new Error("no inline dataset");

  const records = dataset.inline.records as Record<string, string[]>;
  const inputs = records.input ?? [];
  const expected = records.expected_output ?? [];
  if (inputs.length >= 6) {
    console.log("already extended");
  } else {
    for (const row of EXTRA_ROWS) {
      inputs.push(row.input);
      expected.push(row.expected_output);
    }
  }

  // Clear results so the whole 6-row grid re-runs from scratch.
  state.results = {
    status: "idle",
    targetOutputs: {},
    targetMetadata: {},
    evaluatorResults: {},
    errors: {},
  };

  await prisma.experiment.update({
    where: { id: experiment.id },
    data: { workbenchState: state },
  });
  console.log(`dataset now has ${inputs.length} rows; results cleared`);
}

main().finally(() => prisma.$disconnect());
