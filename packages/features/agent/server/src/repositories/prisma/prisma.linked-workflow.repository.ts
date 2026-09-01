import type { AgentFields, RelatedAgentEntities } from "@langwatch/agent-contract";
import type { PrismaClient } from "@langwatch/prisma-client/generated";
import { linkedWorkflowFields } from "./prisma.linked-workflow.mapper";

/**
 * The workflow row an agent points at, read and written directly.
 *
 * Four of the five things {@link AgentsWorkflowPort} needs are exactly this:
 * the fields a graph declares, the workflow's name, archiving it, and deleting
 * it after a copy that failed. None of them goes through the Workflow
 * lifecycle — they are one row and its versions — so none of them is a reason
 * for a process to receive its agent service from somewhere else.
 *
 * The fifth, copying the graph, is not here and cannot be: see
 * `LinkedWorkflowCopyPort`.
 *
 * Every query names `projectId`. The workflow ids reaching this repository
 * come from an agent's stored `workflowId`, and an agent whose row was written
 * before a project moved could name a workflow the caller may not read.
 */
export class PrismaLinkedWorkflowRepository {
  static create(database: PrismaClient): PrismaLinkedWorkflowRepository {
    return new PrismaLinkedWorkflowRepository(database);
  }

  private constructor(private readonly database: PrismaClient) {}

  /**
   * The fields each of the named graphs declares, keyed by workflow id.
   *
   * One query for the whole list rather than one per agent: a project listing
   * its agents resolves every workflow agent's shape in the same read.
   */
  async fields(input: {
    projectId: string;
    workflowIds: string[];
  }): Promise<Record<string, AgentFields>> {
    const workflows = await this.database.workflow.findMany({
      where: {
        id: { in: input.workflowIds },
        projectId: input.projectId,
        archivedAt: null,
      },
      include: { currentVersion: true },
    });
    return Object.fromEntries(
      workflows.map((workflow) => [
        workflow.id,
        linkedWorkflowFields(workflow.currentVersion?.dsl),
      ]),
    );
  }

  /** The linked workflow's identity, or nothing when it is archived or elsewhere. */
  related(input: {
    projectId: string;
    workflowId: string;
  }): Promise<RelatedAgentEntities["workflow"]> {
    return this.database.workflow.findFirst({
      where: { id: input.workflowId, projectId: input.projectId, archivedAt: null },
      select: { id: true, name: true },
    });
  }

  /** Soft-deletes the graph, so an archived agent takes its workflow with it. */
  archive(input: { workflowId: string; projectId: string }): Promise<{ id: string }> {
    return this.database.workflow.update({
      where: { id: input.workflowId, projectId: input.projectId },
      data: { archivedAt: new Date() },
      select: { id: true },
    });
  }

  /**
   * Hard-deletes a graph, in the order its own foreign keys allow.
   *
   * This is the rollback for a copy whose agent row failed to write, not a
   * product operation: the workflow was created seconds ago in the target
   * project and nothing points at it yet. The current and latest version
   * pointers are cleared first and the version parentage second, because both
   * are `onDelete: Restrict` — deleting the versions with either still set
   * fails on the constraint rather than on anything a caller could act on.
   */
  async remove(input: { workflowId: string; projectId: string }): Promise<void> {
    await this.database.workflow.update({
      where: { id: input.workflowId, projectId: input.projectId },
      data: { currentVersionId: null, latestVersionId: null },
    });
    await this.database.workflowVersion.updateMany({
      where: { workflowId: input.workflowId, projectId: input.projectId },
      data: { parentId: null },
    });
    await this.database.workflowVersion.deleteMany({
      where: { workflowId: input.workflowId, projectId: input.projectId },
    });
    await this.database.workflow.delete({
      where: { id: input.workflowId, projectId: input.projectId },
    });
  }
}
