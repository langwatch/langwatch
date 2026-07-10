import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();
async function main() {
  const project = await prisma.project.findFirst({ where: { slug: "d-1h5icu" } });
  const exp = await prisma.experiment.findFirst({ where: { projectId: project!.id, slug: "lively-glad-wave" } });
  const s = exp!.workbenchState as any;
  for (const d of s.datasets ?? []) {
    console.log("dataset", d.id, d.type);
    console.log(JSON.stringify(d.inline?.records ?? d.savedRecords ?? null).slice(0, 600));
  }
}
main().finally(() => prisma.$disconnect());
