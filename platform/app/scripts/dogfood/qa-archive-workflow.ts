/**
 * Archives (or restores) a workflow, to QA how a workflow agent target behaves
 * when its linked Studio workflow can no longer be read.
 *
 * Usage:
 *   WORKFLOW_ID=wf_x ARCHIVE=1 npx tsx scripts/dogfood/qa-archive-workflow.ts
 */
import { prisma } from "../../src/server/db";

async function main() {
  const id = process.env.WORKFLOW_ID;
  if (!id) throw new Error("WORKFLOW_ID is required");
  const archive = process.env.ARCHIVE === "1";
  await prisma.workflow.update({
    where: { id },
    data: { archivedAt: archive ? new Date() : null },
  });
  console.log(archive ? "archived" : "restored");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
