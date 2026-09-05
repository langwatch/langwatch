import type { PrismaClient } from "@langwatch/prisma-client/generated";

/**
 * The project's workflow-backed evaluators, each carrying only its published
 * version — an unpublished draft is not something another surface may run.
 *
 * The rows belong to the Workflow table, so this stays a process-level read
 * shared by the evaluation tRPC transport and the legacy evaluation REST
 * routes, until the Workflow vertical owns the query. The client is passed in
 * rather than imported: this package composes no database of its own.
 */
export const listCustomEvaluators = async ({
  prisma,
  projectId,
}: {
  prisma: PrismaClient;
  projectId: string;
}) => {
  const workflows = await prisma.workflow.findMany({
    where: {
      projectId,
      isEvaluator: true,
    },
    include: {
      versions: true,
    },
  });

  return workflows.map((workflow) => ({
    ...workflow,
    versions: workflow.versions.filter((version) => version.id === workflow.publishedId),
  }));
};
