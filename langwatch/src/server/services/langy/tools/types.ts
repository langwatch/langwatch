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
  /**
   * Phase-5 producer (PR-5.1, Mastra-only). When true, `propose_suggestion`
   * is registered with the agent. Left unset on the legacy AI-SDK path so
   * suggestions stay off until the Mastra cutover completes.
   */
  suggestionsEnabled?: boolean;
  /**
   * Per-turn counter consumed by `propose_suggestion` to enforce the
   * "at most one suggestion per turn" rule. The route creates a fresh
   * `{ count: 0 }` object per chat POST since one POST = one turn.
   */
  suggestionEmissionTracker?: { count: number };
  /**
   * The user's saved "don't show this kind again" list, loaded from
   * `LangyUserPreferences`. The propose_suggestion tool refuses kinds in
   * this list as a server-side belt to the frontend filter in PR-5.2.
   */
  dismissedSuggestionKinds?: string[];
}
