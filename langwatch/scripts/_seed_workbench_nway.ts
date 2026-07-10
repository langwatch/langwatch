/**
 * Wire 3 seeded prompts + an N-way Compare evaluator into the
 * lively-glad-wave workbench in project d-1h5icu. Bypasses the UI's
 * click-through so we can drive Run + Results end-to-end.
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const project = await prisma.project.findFirst({
    where: { slug: "d-1h5icu" },
  });
  if (!project) throw new Error("project d-1h5icu not found");

  const prompts = await prisma.llmPromptConfig.findMany({
    where: {
      projectId: project.id,
      handle: {
        in: [
          "polite-assistant-v1",
          "concise-support-v2",
          "friendly-support-v3",
        ],
      },
    },
    include: { versions: { orderBy: { version: "desc" }, take: 1 } },
  });
  if (prompts.length !== 3) throw new Error(`expected 3 prompts, got ${prompts.length}`);

  const experiment = await prisma.experiment.findFirst({
    where: { projectId: project.id, slug: "lively-glad-wave" },
  });
  if (!experiment) throw new Error("experiment lively-glad-wave not found");

  const targets = prompts.map((p, i) => {
    return {
      id: `target_${Date.now()}_${i}`,
      name: p.handle,
      type: "prompt" as const,
      promptId: p.id,
      promptVersionId: p.versions[0]?.id,
      inputs: [{ identifier: "input", type: "str" }],
      outputs: [{ identifier: "output", type: "str" }],
      mappings: {
        "test-data": {
          input: { type: "source", source: "dataset", sourceId: "test-data", sourceField: "input" },
        },
      },
    };
  });

  const evaluator = {
    id: `evaluator_${Date.now()}`,
    name: "N-way Compare",
    evaluatorType: "langevals/select_best_compare",
    inputs: [
      { identifier: "input", type: "str" as const },
      { identifier: "golden", type: "str" as const },
      { identifier: "candidates", type: "list" as const },
      { identifier: "row_index", type: "float" as const },
    ],
    settings: {
      model: "openai/gpt-5-mini",
      has_golden_answer: true,
      allow_tie: true,
      randomize_order: true,
    },
    mappings: {},
    selectBest: {
      variants: targets.map((t) => t.id),
      hasGoldenAnswer: true,
      goldenField: "expected_output",
      includeMetrics: [],
      randomizeOrder: true,
    },
  };

  const current = experiment.workbenchState as Record<string, unknown>;
  const nextState = {
    ...current,
    targets,
    evaluators: [evaluator],
  };

  await prisma.experiment.update({
    where: { id: experiment.id },
    data: { workbenchState: nextState },
  });

  console.log("targets:", targets.map((t) => t.name).join(", "));
  console.log("evaluator: N-way Compare with 3 variants + golden=expected_output");
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
