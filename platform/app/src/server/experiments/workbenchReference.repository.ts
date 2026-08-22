import { type PrismaClient, PromptScope } from "~/generated/prisma/client";

/** The kinds of row a workbench state can point at. */
export type WorkbenchReferenceType =
  | "prompt"
  | "agent"
  | "evaluator"
  | "workflow"
  | "dataset";

/**
 * Existence checks for the rows a workbench state points at.
 *
 * One query per kind, never one per reference, and every query names the
 * project: a state that points at another tenant's row must read exactly the
 * same as one that points at a row nobody has.
 *
 * The checks are deliberately looser than the row filters the executor uses.
 * They answer "does this project have such a row at all", so a reference the
 * executor would still resolve can never be refused here; what they do catch
 * is the reference whose row is gone, which is the failure a person actually
 * hits after deleting a prompt or a dataset the workbench still names.
 */
export class WorkbenchReferenceRepository {
  constructor(private readonly prisma: PrismaClient) {}

  /**
   * Returns the subset of `ids` this project can reach. The caller compares
   * the result with what it asked for and names the first id that is absent.
   */
  async findExistingIds({
    refType,
    ids,
    projectId,
  }: {
    refType: WorkbenchReferenceType;
    ids: readonly string[];
    projectId: string;
  }): Promise<Set<string>> {
    if (ids.length === 0) return new Set();
    const unique = [...new Set(ids)];

    switch (refType) {
      case "prompt":
        return this.findExistingPromptIds({ ids: unique, projectId });
      case "agent": {
        const rows = await this.prisma.agent.findMany({
          where: { projectId, id: { in: unique } },
          select: { id: true },
        });
        return new Set(rows.map((row) => row.id));
      }
      case "evaluator": {
        const rows = await this.prisma.evaluator.findMany({
          where: { projectId, id: { in: unique } },
          select: { id: true },
        });
        return new Set(rows.map((row) => row.id));
      }
      case "workflow": {
        const rows = await this.prisma.workflow.findMany({
          where: { projectId, id: { in: unique } },
          select: { id: true },
        });
        return new Set(rows.map((row) => row.id));
      }
      case "dataset": {
        const rows = await this.prisma.dataset.findMany({
          where: { projectId, id: { in: unique } },
          select: { id: true },
        });
        return new Set(rows.map((row) => row.id));
      }
    }
  }

  /**
   * Prompts are the one reference that is not a plain project-scoped id: a
   * target may name a handle instead of an id, and an organization-scoped
   * prompt lives on another project's row while still being usable here. The
   * where clause mirrors the one the prompt repository resolves targets with
   * at run time, so the two cannot disagree about what exists.
   */
  private async findExistingPromptIds({
    ids,
    projectId,
  }: {
    ids: string[];
    projectId: string;
  }): Promise<Set<string>> {
    const project = await this.prisma.project.findUnique({
      where: { id: projectId },
      select: { team: { select: { organizationId: true } } },
    });
    const organizationId = project?.team?.organizationId;

    const rows = await this.prisma.llmPromptConfig.findMany({
      where: {
        OR: [
          { projectId, OR: [{ id: { in: ids } }, { handle: { in: ids } }] },
          ...(organizationId
            ? [
                {
                  organizationId,
                  scope: PromptScope.ORGANIZATION,
                  OR: [{ id: { in: ids } }, { handle: { in: ids } }],
                },
              ]
            : []),
        ],
      },
      select: { id: true, handle: true },
    });

    const found = new Set<string>();
    for (const row of rows) {
      found.add(row.id);
      if (row.handle) found.add(row.handle);
    }
    return found;
  }
}
