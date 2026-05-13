/**
 * Per-request context passed to every Langy tool factory.
 *
 * Tools are defined as factories (`makeXxx(ctx)`) rather than free
 * closures so the same definition can be threaded through the legacy
 * Vercel AI SDK runtime today and the Mastra runtime in Phase 4.3+
 * without reworking each tool.
 *
 * Tools must NOT receive a PrismaClient. All entity reads go through
 * the service layer below — see PR-4.1.
 */
import type { DatasetService } from "~/server/datasets/dataset.service";
import type { BatchEvaluationService } from "~/server/evaluations/batch-evaluation.service";
import type { EvaluatorService } from "~/server/evaluators/evaluator.service";
import type { ExperimentService } from "~/server/experiments/experiment.service";
import type { ProjectService } from "~/server/app-layer/projects/project.service";
import type { PromptService } from "~/server/prompt-config/prompt.service";
import type { ConversationToolIdSet } from "../toolIdValidator";

export interface LangyConversationContext {
  projectId: string;
  experimentSlug?: string;
  batchEvaluationService: BatchEvaluationService;
  datasetService: DatasetService;
  evaluatorService: EvaluatorService;
  experimentService: ExperimentService;
  projectService: ProjectService;
  promptService: PromptService;
  seenIds: ConversationToolIdSet;
}
