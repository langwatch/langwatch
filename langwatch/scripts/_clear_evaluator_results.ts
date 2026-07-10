/**
 * Wipe the stale "evaluatorblock: Data required" results so the next Run
 * starts from a clean slate.
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const project = await prisma.project.findFirst({
    where: { slug: "d-1h5icu" },
  });
  if (!project) throw new Error("project d-1h5icu not found");

  const experiment = await prisma.experiment.findFirst({
    where: { projectId: project.id, slug: "lively-glad-wave" },
  });
  if (!experiment) throw new Error("experiment lively-glad-wave not found");

  const state = experiment.workbenchState as Record<string, any>;
  const results = { ...(state.results ?? {}), evaluatorResults: {}, errors: {} };

  await prisma.experiment.update({
    where: { id: experiment.id },
    data: { workbenchState: { ...state, results } },
  });

  console.log("cleared evaluatorResults + errors");
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
