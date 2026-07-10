/** Dogfood helper: show the comparison config shape stored in each workbench. */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const shapes = (o: Record<string, unknown>) =>
  ["comparison", "selectBest", "pairwise"]
    .filter((k) => o[k])
    .map((k) => `+${k}`)
    .join(" ");

async function main() {
  const project = await prisma.project.findFirst({ where: { slug: "d-1h5icu" } });
  if (!project) {
    console.log("NO PROJECT d-1h5icu");
    return;
  }
  const exps = await prisma.experiment.findMany({
    where: { projectId: project.id },
    select: { slug: true, workbenchState: true },
  });
  for (const e of exps) {
    const s = (e.workbenchState ?? {}) as Record<string, any>;
    if (!s.targets) continue;
    console.log("---", e.slug);
    for (const t of s.targets ?? []) {
      console.log(`  target ${t.id} (${t.type}) ${shapes(t)}`);
    }
    for (const x of s.evaluators ?? []) {
      console.log(`  evaluator ${x.id} [${x.evaluatorType}] ${shapes(x)}`);
    }
    const er = s.results?.evaluatorResults ?? {};
    for (const [tid, byEval] of Object.entries(er)) {
      for (const [eid, rows] of Object.entries(byEval as Record<string, any[]>)) {
        console.log(
          `  results ${tid}/${eid}: ${rows.map((r) => r?.label ?? r?.status ?? "?").join(", ")}`,
        );
      }
    }
  }
}

main().finally(() => prisma.$disconnect());
