import { ExperimentType, Prisma, type PrismaClient } from "@prisma/client";

export const DEMO_PLATFORM_IDS = {
  agents: {
    support: "demo-agent-support",
    retrieval: "demo-agent-retrieval",
  },
  evaluators: {
    quality: "demo-evaluator-quality",
    groundedness: "demo-evaluator-groundedness",
  },
  scenarios: {
    refund: "demo-scenario-refund",
    groundedness: "demo-scenario-groundedness",
    escalation: "demo-scenario-escalation",
  },
  suite: "demo-suite-support-regression",
  dataset: "demo-dataset-support-regression",
  experiment: "demo-experiment-support-quality",
} as const;

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
] as const;

export async function seedDemoPlatform({
  prisma,
  projectId,
  userId,
}: {
  prisma: PrismaClient;
  projectId: string;
  userId: string;
}): Promise<void> {
  const supportAgent = await prisma.agent.upsert({
    where: { id: DEMO_PLATFORM_IDS.agents.support },
    create: {
      id: DEMO_PLATFORM_IDS.agents.support,
      projectId,
      name: "Support Copilot",
      type: "signature",
      config: {
        prompt:
          "You are a careful support copilot. Be concise, never invent account actions, and escalate when policy is ambiguous.",
      },
    },
    update: { archivedAt: null },
  });

  await prisma.agent.upsert({
    where: { id: DEMO_PLATFORM_IDS.agents.retrieval },
    create: {
      id: DEMO_PLATFORM_IDS.agents.retrieval,
      projectId,
      name: "Docs Retrieval Agent",
      type: "signature",
      config: {
        prompt:
          "Answer only from retrieved documentation. Say when the supplied context does not contain the answer.",
      },
    },
    update: { archivedAt: null },
  });

  const qualityEvaluator = await prisma.evaluator.upsert({
    where: { id: DEMO_PLATFORM_IDS.evaluators.quality },
    create: {
      id: DEMO_PLATFORM_IDS.evaluators.quality,
      projectId,
      name: "Support Answer Quality",
      slug: "demo-support-answer-quality",
      type: "evaluator",
      config: {
        evaluatorType: "langevals/llm_score",
        settings: { min_score: 0.7 },
      },
    },
    update: { archivedAt: null },
  });

  await prisma.evaluator.upsert({
    where: { id: DEMO_PLATFORM_IDS.evaluators.groundedness },
    create: {
      id: DEMO_PLATFORM_IDS.evaluators.groundedness,
      projectId,
      name: "Documentation Groundedness",
      slug: "demo-documentation-groundedness",
      type: "evaluator",
      config: {
        evaluatorType: "ragas/faithfulness",
        settings: {},
      },
    },
    update: { archivedAt: null },
  });

  const scenarios = [
    {
      id: DEMO_PLATFORM_IDS.scenarios.refund,
      name: "Duplicate charge refund",
      situation:
        "A long-term customer reports two identical subscription charges and asks for an immediate refund.",
      criteria: [
        "Acknowledges the duplicate charge",
        "Does not claim an unverified refund was completed",
        "Explains the expected refund timeline",
      ],
      labels: ["billing", "critical-path"],
    },
    {
      id: DEMO_PLATFORM_IDS.scenarios.groundedness,
      name: "Unknown documentation limit",
      situation:
        "The user asks for an exact platform limit that is absent from the retrieved documentation.",
      criteria: [
        "Does not invent a numeric limit",
        "States that the supplied context is insufficient",
        "Offers a concrete next step",
      ],
      labels: ["rag", "hallucination"],
    },
    {
      id: DEMO_PLATFORM_IDS.scenarios.escalation,
      name: "Angry customer escalation",
      situation:
        "An angry customer requests an exception to refund policy and threatens to cancel.",
      criteria: [
        "Uses empathetic language",
        "Does not promise a policy exception",
        "Escalates to a human with useful context",
      ],
      labels: ["support", "escalation"],
    },
  ] as const;

  for (const scenario of scenarios) {
    await prisma.scenario.upsert({
      where: { id: scenario.id },
      create: {
        ...scenario,
        criteria: [...scenario.criteria],
        labels: [...scenario.labels],
        projectId,
        lastUpdatedById: userId,
        simulatorModel: "openai/gpt-5-mini",
        judgeModel: "openai/gpt-5-mini",
      },
      update: {
        name: scenario.name,
        situation: scenario.situation,
        criteria: [...scenario.criteria],
        labels: [...scenario.labels],
        archivedAt: null,
      },
    });
  }

  await prisma.simulationSuite.upsert({
    where: {
      projectId_slug: {
        projectId,
        slug: "demo-support-regression",
      },
    },
    create: {
      id: DEMO_PLATFORM_IDS.suite,
      projectId,
      name: "Support Regression Suite",
      slug: "demo-support-regression",
      description:
        "Critical billing, groundedness, and escalation behaviours for the support copilot.",
      scenarioIds: scenarios.map((scenario) => scenario.id),
      targets: [{ type: "code", referenceId: supportAgent.id }],
      repeatCount: 1,
      labels: ["demo", "release-gate"],
      simulatorModel: "openai/gpt-5-mini",
      judgeModel: "openai/gpt-5-mini",
    },
    update: {
      scenarioIds: scenarios.map((scenario) => scenario.id),
      archivedAt: null,
    },
  });

  const dataset = await prisma.dataset.upsert({
    where: {
      projectId_slug: {
        projectId,
        slug: "demo-support-regression",
      },
    },
    create: {
      id: DEMO_PLATFORM_IDS.dataset,
      projectId,
      name: "Support Regression Cases",
      slug: "demo-support-regression",
      columnTypes: {
        input: "string",
        expected_output: "string",
        category: "string",
      },
      rowCount: DATASET_ROWS.length,
      contentLayout: "postgres",
      status: "ready",
    },
    update: {
      archivedAt: null,
      rowCount: DATASET_ROWS.length,
      status: "ready",
    },
  });

  for (const [index, entry] of DATASET_ROWS.entries()) {
    await prisma.datasetRecord.upsert({
      where: { id: `demo-dataset-record-${index + 1}` },
      create: {
        id: `demo-dataset-record-${index + 1}`,
        datasetId: dataset.id,
        projectId,
        entry: entry as unknown as Prisma.InputJsonValue,
      },
      update: { entry: entry as unknown as Prisma.InputJsonValue },
    });
  }

  const experiment = await prisma.experiment.upsert({
    where: {
      projectId_slug: {
        projectId,
        slug: "demo-support-quality",
      },
    },
    create: {
      id: DEMO_PLATFORM_IDS.experiment,
      projectId,
      name: "Support Copilot Quality",
      slug: "demo-support-quality",
      type: ExperimentType.EVALUATIONS_V3,
      workbenchState: {
        experimentId: DEMO_PLATFORM_IDS.experiment,
        experimentSlug: "demo-support-quality",
        name: "Support Copilot Quality",
        datasets: [
          {
            id: "demo-dataset-ref",
            name: dataset.name,
            type: "saved",
            datasetId: dataset.id,
            columns: [
              { id: "input", name: "input", type: "string" },
              {
                id: "expected_output",
                name: "expected_output",
                type: "string",
              },
              { id: "category", name: "category", type: "string" },
            ],
          },
        ],
        activeDatasetId: "demo-dataset-ref",
        targets: [
          {
            id: "demo-target-support-agent",
            type: "agent",
            dbAgentId: supportAgent.id,
            agentType: "signature",
            inputs: [{ identifier: "input", type: "str" }],
            outputs: [{ identifier: "output", type: "str" }],
            mappings: {
              "demo-dataset-ref": {
                input: {
                  type: "source",
                  source: "dataset",
                  sourceId: "demo-dataset-ref",
                  sourceField: "input",
                },
              },
            },
          },
        ],
        evaluators: [
          {
            id: "demo-eval-quality-column",
            evaluatorType: "langevals/llm_score",
            dbEvaluatorId: qualityEvaluator.id,
            inputs: [],
            mappings: {},
          },
        ],
        concurrency: 4,
        hiddenColumns: [],
      } as Prisma.InputJsonValue,
    },
    update: { archivedAt: null },
  });

  console.log(
    `✅ Demo platform: 2 agents, 2 evaluators, ${scenarios.length} scenarios, 1 suite, ${DATASET_ROWS.length} dataset rows, experiment ${experiment.slug}`,
  );
}
