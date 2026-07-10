/** Dogfood helper: rename the seeded "N-way Compare" evaluator to "Comparison". */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const project = await prisma.project.findFirst({ where: { slug: "d-1h5icu" } });
  if (!project) throw new Error("project d-1h5icu not found");

  const updated = await prisma.evaluator.updateMany({
    where: { projectId: project.id, name: "N-way Compare" },
    data: { name: "Comparison" },
  });
  console.log(`renamed ${updated.count} DB evaluator row(s)`);

  const experiment = await prisma.experiment.findFirst({
    where: { projectId: project.id, slug: "lively-glad-wave" },
  });
  if (!experiment) throw new Error("experiment not found");

  const state = experiment.workbenchState as Record<string, any>;
  for (const evaluator of state.evaluators ?? []) {
    if (evaluator.localEvaluatorConfig?.name === "N-way Compare") {
      evaluator.localEvaluatorConfig.name = "Comparison";
    }
  }
  // Clear results so the re-run stores the new name on its evaluations.
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
  console.log("workbench evaluator renamed; results cleared");
}

main().finally(() => prisma.$disconnect());
