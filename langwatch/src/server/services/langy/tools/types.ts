/**
 * Per-request context passed to every Langy tool factory.
 *
 * Tools are defined as factories (`makeXxx(ctx)`) rather than free
 * closures so the same definition can be threaded through the legacy
 * Vercel AI SDK runtime today and the Mastra runtime in Phase 4.3+
 * without reworking each tool.
 */
import type { PrismaClient } from "@prisma/client";
import type { EvaluatorService } from "~/server/evaluators/evaluator.service";
import type { PromptService } from "~/server/prompt-config/prompt.service";
import type { ConversationToolIdSet } from "../toolIdValidator";

export interface LangyToolContext {
  projectId: string;
  experimentSlug?: string;
  evaluatorService: EvaluatorService;
  promptService: PromptService;
  seenIds: ConversationToolIdSet;
  prisma: PrismaClient;
}
