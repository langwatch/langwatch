/**
 * Dogfood helper: rename `selectBest` -> `comparison` in stored workbench state.
 *
 * `select_best_compare` never shipped, so this is not a product migration — it
 * only repairs experiments created on this branch before the pairwise/N-way
 * merge, which would otherwise lose their comparison column on load. The two
 * shapes are identical; only the key was renamed.
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const rename = (entries: Record<string, unknown>[]): number => {
  let changed = 0;
  for (const entry of entries) {
    if (entry.selectBest && !entry.comparison) {
      entry.comparison = entry.selectBest;
      delete entry.selectBest;
      changed++;
    }
  }
  return changed;
};

async function main() {
  const experiments = await prisma.experiment.findMany({
    select: { id: true, slug: true, workbenchState: true },
  });

  for (const experiment of experiments) {
    const state = experiment.workbenchState as Record<string, any> | null;
    if (!state?.targets && !state?.evaluators) continue;

    const changed =
      rename(state.targets ?? []) + rename(state.evaluators ?? []);
    if (changed === 0) continue;

    await prisma.experiment.update({
      where: { id: experiment.id },
      data: { workbenchState: state },
    });
    console.log(`${experiment.slug}: renamed ${changed} selectBest -> comparison`);
  }
  console.log("done");
}

main().finally(() => prisma.$disconnect());
