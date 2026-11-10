import { EvaluatorDeployedLabelProtectedError } from "@langwatch/evaluator-contract";
import { createLogger } from "@langwatch/observability";

import type { EvaluatorDeletionFactsService } from "./evaluator-deletion-facts.service.ts";
import type { EvaluatorVersionService } from "./evaluator-version.service.ts";
import type { EvaluatorService } from "./evaluator.service.ts";

const logger = createLogger("langwatch:evaluator:workflow-archive-cascade");

/**
 * Archives the live evaluators a workflow backed once workflow records its archive (§9, plan §7).
 * The fact names no caller, so a deployed evaluator fails the deploy check and stays live.
 * Spec: modules/evaluator/specs/evaluator-deleted-fact.feature
 */
export class EvaluatorWorkflowArchiveService {
  static create(deps: {
    evaluators: Pick<EvaluatorService, "findByWorkflow" | "archive">;
    versions: Pick<EvaluatorVersionService, "assertDeletable">;
    deletionFacts: Pick<EvaluatorDeletionFactsService, "recordEvaluatorDeleted">;
  }): EvaluatorWorkflowArchiveService {
    return new EvaluatorWorkflowArchiveService(deps);
  }

  private constructor(
    private readonly deps: Parameters<typeof EvaluatorWorkflowArchiveService.create>[0],
  ) {}

  /** Records the deleted fact before the archive, so a retry after a failed record finds it. */
  async archiveForWorkflow(input: { workflowId: string; projectId: string }): Promise<void> {
    for (const evaluator of await this.deps.evaluators.findByWorkflow(input)) {
      if (!(await this.#mayArchive({ ...input, evaluatorId: evaluator.id }))) {
        continue;
      }
      await this.deps.deletionFacts.recordEvaluatorDeleted({
        projectId: input.projectId,
        evaluatorId: evaluator.id,
      });
      await this.deps.evaluators.archive({ id: evaluator.id, projectId: input.projectId });
    }
  }

  async #mayArchive(input: {
    projectId: string;
    workflowId: string;
    evaluatorId: string;
  }): Promise<boolean> {
    try {
      await this.deps.versions.assertDeletable({
        projectId: input.projectId,
        evaluatorId: input.evaluatorId,
        caller: undefined,
      });
      return true;
    } catch (error) {
      if (!(error instanceof EvaluatorDeployedLabelProtectedError)) throw error;
      logger.warn(
        { ...input, labels: error.meta?.labels },
        "deployed evaluator kept live when its workflow was archived",
      );
      return false;
    }
  }
}
