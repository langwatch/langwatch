/**
 * Builds the collaborators `EvaluatorApp` used to receive hand-composed
 * (`apps/api/src/features/evaluator/evaluator.composition.ts`, deleted by
 * b383462d96). `EvaluatorApp.create` now builds the workflow/monitor graph
 * itself from the one member it reads — `prisma` — and its `workflows`
 * dependency, on the exact prisma calls and the exact `workflows` calls the
 * deleted `ProcessEvaluatorGraph` made.
 *
 * The NLP dispatcher has no member and no contract to depend on —
 * `EvaluatorNlpDispatcher` is a one-method structural type precisely so this
 * module never depends on another module's server package — so a deployment
 * that supplies none gets a proxy that refuses by name on first use, rather
 * than the silent `undefined` crash the deleted composition's absence left
 * behind.
 */
import { EvaluatorWorkflowVersionRequiredError } from "@langwatch/evaluator-contract";
import type { PrismaClient } from "@langwatch/prisma-client/generated";
import { nowInstant, toDate } from "@langwatch/time";
import type { WorkflowApi } from "@langwatch/workflow-contract";

import type { EvaluatorNlpDispatcher } from "../services/evaluator-code-execution.service.ts";
import type { EvaluatorGraph } from "./evaluator.app.ts";

/**
 * The workflow and monitor rows an evaluator is entangled with. Four of the
 * six methods are row reads and writes on this process's own connection; the
 * replication pair goes through `workflows` because a replicated evaluator's
 * workflow is a Studio-graph copy, never a row copy.
 */
export class EvaluatorGraphAdapter implements EvaluatorGraph {
  static create(options: { prisma: PrismaClient; workflows: WorkflowApi }): EvaluatorGraphAdapter {
    return new EvaluatorGraphAdapter(options.prisma, options.workflows);
  }

  private constructor(
    private readonly prisma: PrismaClient,
    private readonly workflows: WorkflowApi,
  ) {}

  findLinkedWorkflow(input: Readonly<{ workflowId: string; projectId: string }>) {
    return this.prisma.workflow.findFirst({
      where: { id: input.workflowId, projectId: input.projectId, archivedAt: null },
      select: { id: true, name: true },
    });
  }

  findMonitorsUsingEvaluator(input: Readonly<{ evaluatorId: string; projectId: string }>) {
    return this.prisma.monitor.findMany({
      where: { evaluatorId: input.evaluatorId, projectId: input.projectId },
      select: { id: true, name: true },
    });
  }

  deleteMonitorsUsingEvaluator(input: Readonly<{ evaluatorId: string; projectId: string }>) {
    return this.prisma.monitor.deleteMany({
      where: { evaluatorId: input.evaluatorId, projectId: input.projectId },
    });
  }

  archiveLinkedWorkflow(input: Readonly<{ workflowId: string; projectId: string }>) {
    return this.prisma.workflow.update({
      where: { id: input.workflowId, projectId: input.projectId },
      data: { archivedAt: toDate(nowInstant()) },
    });
  }

  /**
   * Refused rather than copied when the graph has no saved version: an
   * evaluator created against one is a structurally broken replica, and the
   * break only shows up when somebody runs it.
   */
  async replicateEvaluatorWorkflow(
    input: Readonly<{
      workflowId: string;
      sourceProjectId: string;
      targetProjectId: string;
      actorId: string;
    }>,
  ): Promise<string> {
    const workflow = await this.prisma.workflow.findFirst({
      where: { id: input.workflowId, projectId: input.sourceProjectId, archivedAt: null },
      include: { latestVersion: true },
    });

    if (!workflow?.latestVersion?.dsl) {
      throw new EvaluatorWorkflowVersionRequiredError(input.workflowId);
    }

    const { workflowId: newWorkflowId, dsl } = await this.workflows.copyStudioWorkflow({
      workflow: {
        id: workflow.id,
        name: workflow.name,
        icon: workflow.icon,
        description: workflow.description,
        isEvaluator: workflow.isEvaluator,
        isComponent: workflow.isComponent,
        latestVersion: workflow.latestVersion,
      },
      targetProjectId: input.targetProjectId,
      sourceProjectId: input.sourceProjectId,
      copiedFromWorkflowId: input.workflowId,
    } as Parameters<WorkflowApi["copyStudioWorkflow"]>[0]);

    try {
      await this.workflows.saveStudioVersion(
        {
          projectId: input.targetProjectId,
          workflowId: newWorkflowId,
          dsl,
          autoSaved: false,
          commitMessage: "Copied from " + workflow.name,
        },
        { id: input.actorId },
      );
    } catch (saveError) {
      await this.deleteReplicatedWorkflow({
        workflowId: newWorkflowId,
        projectId: input.targetProjectId,
      }).catch(() => void 0);

      throw saveError;
    }

    return newWorkflowId;
  }

  /**
   * `deleteMany` rather than `delete` so the multitenancy guard accepts the
   * project scope: a bare `{ id }` delete is rejected and this rollback would
   * silently no-op.
   */
  async deleteReplicatedWorkflow(
    input: Readonly<{ workflowId: string; projectId: string }>,
  ): Promise<void> {
    await this.prisma.workflow.deleteMany({
      where: { id: input.workflowId, projectId: input.projectId },
    });
  }
}

/**
 * Refuses by name rather than crashing on `undefined`: no deployment supplies
 * this module an NLP dispatcher yet (its builder died with the deleted
 * composition and nothing replaced it), so the one capability that needs it —
 * running a code evaluator — fails with an attributable error instead of a
 * silent `TypeError` the first time a customer runs one.
 */
export function refusingEvaluatorNlpDispatcher(): EvaluatorNlpDispatcher {
  return {
    dispatch() {
      return Promise.reject(
        new Error(
          "This deployment did not supply the evaluator module an NLP runtime, so a code evaluator cannot run",
        ),
      );
    },
  };
}
