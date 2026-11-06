import type { DatasetApi } from "@langwatch/dataset-contract";
import { createLogger } from "@langwatch/observability";
import { ExperimentType, type Prisma, type PrismaClient } from "@langwatch/prisma-client/generated";

import {
  DEMO_PLATFORM_IDS,
  demoHttpAgentConfig,
  DEMO_PROMPT_CONFIG_DATA,
} from "./demo-platform-ids.ts";
import { seedDemoDataset } from "./seed-demo-dataset.ts";

export async function seedDemoPlatform({
  prisma,
  datasets,
  projectId,
  organizationId,
  userId,
  environment,
}: {
  prisma: PrismaClient;
  datasets: DatasetApi;
  projectId: string;
  organizationId: string;
  userId: string;
  environment: Readonly<Record<string, string | undefined>>;
}): Promise<void> {
  const supportAgent = await prisma.agent.upsert({
    where: { id: DEMO_PLATFORM_IDS.agents.support, projectId },
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
    where: { id: DEMO_PLATFORM_IDS.agents.retrieval, projectId },
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

  await prisma.agent.upsert({
    where: { id: DEMO_PLATFORM_IDS.agents.httpEcho, projectId },
    create: {
      id: DEMO_PLATFORM_IDS.agents.httpEcho,
      projectId,
      name: "HTTP Echo Agent",
      type: "http",
      config: demoHttpAgentConfig({ environment }) as Prisma.InputJsonValue,
    },
    update: { archivedAt: null },
  });

  const prompt = await prisma.llmPromptConfig.upsert({
    where: { id: DEMO_PLATFORM_IDS.prompt },
    create: {
      id: DEMO_PLATFORM_IDS.prompt,
      handle: "demo-support-copilot",
      name: "Support Copilot Prompt",
      projectId,
      organizationId,
      scope: "PROJECT",
    },
    update: { deletedAt: null },
  });

  await prisma.llmPromptConfigVersion.upsert({
    where: { configId_version: { configId: prompt.id, version: 1 }, projectId },
    create: {
      id: DEMO_PLATFORM_IDS.promptVersion,
      configId: prompt.id,
      version: 1,
      commitMessage: "Seed the demo support-copilot prompt",
      authorId: userId,
      projectId,
      schemaVersion: "1.0",
      configData: DEMO_PROMPT_CONFIG_DATA as Prisma.InputJsonValue,
    },
    update: {},
  });

  const qualityEvaluator = await prisma.evaluator.upsert({
    where: { id: DEMO_PLATFORM_IDS.evaluators.quality, projectId },
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
    where: { id: DEMO_PLATFORM_IDS.evaluators.groundedness, projectId },
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
      where: { id: scenario.id, projectId },
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
      projectId,
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

  const dataset = await seedDemoDataset({ datasets, projectId });

  const experiment = await prisma.experiment.upsert({
    where: {
      projectId_slug: {
        projectId,
        slug: "demo-support-quality",
      },
      projectId,
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

  createLogger("langwatch:tasks:storage-seed").info(
    {
      agents: 3,
      prompts: 1,
      evaluators: 2,
      scenarios: scenarios.length,
      suites: 1,
      dataset: dataset.slug,
      experiment: experiment.slug,
    },
    "seeded the demo platform",
  );
}
