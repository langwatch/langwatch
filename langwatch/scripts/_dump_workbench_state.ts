/**
 * Dump the lively-glad-wave workbench state so we can see the real target
 * outputs produced by the 3 seeded prompts (and what, if anything, landed
 * in evaluatorResults).
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
  const out = {
    targets: (state.targets ?? []).map((t: any) => ({
      id: t.id,
      name: t.name,
      type: t.type,
    })),
    evaluators: (state.evaluators ?? []).map((e: any) => ({
      id: e.id,
      name: e.name,
      evaluatorType: e.evaluatorType,
      selectBest: e.selectBest,
      dbEvaluatorId: e.dbEvaluatorId,
    })),
    resultKeys: Object.keys(state.results ?? {}),
    targetOutputs: state.results?.targetOutputs ?? null,
    evaluatorResults: state.results?.evaluatorResults ?? null,
    datasetColumns: (state.datasets ?? []).map((d: any) => ({
      id: d.id,
      type: d.type,
      columns: d.inline?.columnTypes?.map((c: any) => c.name),
    })),
    inlineRecords: (state.datasets ?? [])[0]?.inline?.records ?? null,
  };
  console.log(JSON.stringify(out, null, 2));
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
