/**
 * Create the DB Evaluator record the workbench's N-way evaluator needs
 * (settings are fetched from DB at execution time; without this row the
 * evaluator cell errors with "evaluatorblock: Data required").
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const project = await prisma.project.findFirst({
    where: { slug: "d-1h5icu" },
  });
  if (!project) throw new Error("project d-1h5icu not found");

  const evaluator = await prisma.evaluator.upsert({
    where: {
      projectId_slug: {
        projectId: project.id,
        slug: "nway-compare-demo",
      },
    },
    update: {
      config: {
        // The evaluate route resolves the judge implementation from
        // config.evaluatorType (falling back to the slug, which 404s).
        evaluatorType: "langevals/select_best_compare",
        settings: {
          model: "openai/gpt-5-mini",
          has_golden_answer: true,
          allow_tie: true,
          randomize_order: true,
          include_metrics: [],
        },
      },
    },
    create: {
      projectId: project.id,
      name: "N-way Compare",
      slug: "nway-compare-demo",
      type: "langevals/select_best_compare",
      config: {
        // The evaluate route resolves the judge implementation from
        // config.evaluatorType (falling back to the slug, which 404s).
        evaluatorType: "langevals/select_best_compare",
        settings: {
          model: "openai/gpt-5-mini",
          has_golden_answer: true,
          allow_tie: true,
          randomize_order: true,
          include_metrics: [],
        },
      },
    },
  });

  // Wire dbEvaluatorId into the workbench evaluator entry
  const experiment = await prisma.experiment.findFirst({
    where: { projectId: project.id, slug: "lively-glad-wave" },
  });
  if (!experiment) throw new Error("experiment lively-glad-wave not found");

  const state = experiment.workbenchState as Record<string, unknown>;
  const evaluators = ((state.evaluators as Array<Record<string, unknown>>) ?? []).map(
    (e) => ({ ...e, dbEvaluatorId: evaluator.id }),
  );
  await prisma.experiment.update({
    where: { id: experiment.id },
    data: { workbenchState: { ...state, evaluators } },
  });

  console.log("evaluator DB row:", evaluator.id);
  console.log("workbench evaluators updated:", evaluators.length);
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
