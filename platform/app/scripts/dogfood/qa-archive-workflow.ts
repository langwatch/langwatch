/**
 * Archives (or restores) a workflow, to QA how a workflow agent target behaves
 * when its linked Studio workflow can no longer be read.
 *
 * Usage:
 *   WORKFLOW_ID=wf_x ARCHIVE=1 npx tsx scripts/dogfood/qa-archive-workflow.ts
 *   WORKFLOW_ID=wf_x ARCHIVE=0 npx tsx scripts/dogfood/qa-archive-workflow.ts
 */
import { prisma } from "../../src/server/db";

async function main() {
  const id = process.env.WORKFLOW_ID;
  if (!id) throw new Error("WORKFLOW_ID is required");

  // Spelled out rather than truthy-checked: ARCHIVE=true would otherwise
  // restore the workflow the operator meant to archive, and the script would
  // report success for it.
  const archive = process.env.ARCHIVE;
  if (archive !== "0" && archive !== "1") {
    throw new Error('ARCHIVE must be "0" or "1"');
  }
  const shouldArchive = archive === "1";

  await prisma.workflow.update({
    where: { id },
    data: { archivedAt: shouldArchive ? new Date() : null },
  });
  console.log(shouldArchive ? "archived" : "restored");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
