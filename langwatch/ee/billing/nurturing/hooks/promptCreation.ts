import type { PrismaClient } from "@prisma/client";
import { getApp } from "../../../../src/server/app-layer/app";
import { createLogger } from "../../../../src/utils/logger/server";
import { captureException } from "../../../../src/utils/posthogErrorCapture";

const logger = createLogger("ee:nurturing:prompt-creation");

/**
 * Fires nurturing calls when a prompt is created.
 *
 * On the first prompt (orgPromptCount === 1):
 *   - Identifies user with has_prompts: true and prompt_count: 1
 *   - Tracks "first_prompt_created" event with project_id
 *
 * On subsequent prompts (orgPromptCount > 1):
 *   - Identifies user with updated prompt_count only
 *   - No event tracked (first_prompt_created only fires once)
 *
 * All calls are fire-and-forget.
 *
 * @param userId - The org admin user ID
 * @param projectId - The project where the prompt was created
 * @param orgPromptCount - The org-wide prompt count AFTER the prompt was created
 */
export function firePromptCreatedNurturing({
  userId,
  projectId,
  orgPromptCount,
}: {
  userId: string;
  projectId: string;
  orgPromptCount: number;
}): void {
  const nurturing = getApp().nurturing;
  if (!nurturing) return;

  const isFirstPrompt = orgPromptCount === 1;

  if (isFirstPrompt) {
    void nurturing
      .identifyUser({
        userId,
        traits: { has_prompts: true, prompt_count: 1 },
      })
      .catch(captureException);

    void nurturing
      .trackEvent({
        userId,
        event: "first_prompt_created",
        properties: { project_id: projectId },
      })
      .catch(captureException);
  } else {
    void nurturing
      .identifyUser({
        userId,
        traits: { prompt_count: orgPromptCount },
      })
      .catch(captureException);
  }
}

/**
 * Counts org-wide non-deleted prompts that have at least one version,
 * resolves the org admin userId, and fires the prompt creation nurturing hook.
 *
 * Used at prompt creation call sites (tRPC and REST API) to avoid
 * duplicating the counting and userId resolution logic.
 *
 * Entirely fire-and-forget: errors are captured but never thrown.
 *
 * @param prisma - PrismaClient for database queries
 * @param projectId - The project where the prompt was created
 * @param userId - The user who created the prompt (optional; resolved via resolveOrgAdmin if missing)
 */
export function afterPromptCreated({
  prisma,
  projectId,
  userId,
}: {
  prisma: PrismaClient;
  projectId: string;
  userId?: string | null;
}): void {
  void (async () => {
    try {
      // Resolve userId if not provided (REST API path)
      let resolvedUserId = userId;
      let organizationId: string | undefined;

      if (!resolvedUserId) {
        const resolution = await getApp().projects.resolveOrgAdmin(projectId);
        resolvedUserId = resolution.userId;
        organizationId = resolution.organizationId ?? undefined;
      }

      if (!resolvedUserId) {
        logger.warn(
          { projectId },
          "No user ID available for prompt creation nurturing — skipping",
        );
        return;
      }

      // Get organizationId if we don't have it yet
      if (!organizationId) {
        const project = await prisma.project.findUnique({
          where: { id: projectId },
          select: { team: { select: { organizationId: true } } },
        });
        organizationId = project?.team?.organizationId ?? undefined;
      }

      if (!organizationId) {
        logger.warn(
          { projectId },
          "Could not resolve organizationId for prompt count — skipping",
        );
        return;
      }

      // Count org-wide non-deleted prompts with at least one version
      const orgPromptCount = await prisma.llmPromptConfig.count({
        where: {
          organizationId,
          deletedAt: null,
          versions: { some: {} },
        },
      });

      firePromptCreatedNurturing({
        userId: resolvedUserId,
        projectId,
        orgPromptCount,
      });
    } catch (error) {
      logger.error(
        { projectId, error },
        "Failed to fire prompt creation nurturing — non-fatal",
      );
      captureException(error);
    }
  })();
}
