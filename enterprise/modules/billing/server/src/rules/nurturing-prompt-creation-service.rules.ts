import {
  findOrganizationAdminResolver,
  findSink,
  reportFailure,
} from "./nurturing-sink-registry-service.rules.ts";
import { createLogger } from "@langwatch/observability";
import type { NurturingPromptCountRepository } from "../repositories/nurturing-prompt-count.repository.ts";

const logger = createLogger("ee:nurturing:prompt-creation");

/**
 * @param userId - The org admin user ID
 * @param projectId - The project where the prompt was created
 * @param orgPromptCount - The org-wide prompt count AFTER the prompt was created
 */
export function firePromptCreated({
  userId,
  projectId,
  orgPromptCount,
}: {
  userId: string;
  projectId: string;
  orgPromptCount: number;
}): void {
  const nurturing = findSink();
  if (!nurturing) {
    return;
  }

  void nurturing
    .identifyUser({
      userId,
      traits: { has_prompts: true, prompt_count: orgPromptCount },
    })
    .catch(reportFailure);

  if (orgPromptCount === 1) {
    void nurturing
      .trackEvent({
        userId,
        event: "first_prompt_created",
        properties: { project_id: projectId },
      })
      .catch(reportFailure);
  }
}

/**
 * @param repository - The org-wide prompt count reads, over its own repository seam
 * @param projectId - The project where the prompt was created
 * @param userId - User who created the prompt; optional
 */
export function afterPromptCreated({
  repository,
  projectId,
  userId,
}: {
  repository: NurturingPromptCountRepository;
  projectId: string;
  userId?: string | null;
}): void {
  void (async () => {
    try {
      // Resolve userId if not provided (REST API path)
      let resolvedUserId = userId;
      let organizationId: string | undefined;

      if (!resolvedUserId) {
        const resolveOrgAdmin = findOrganizationAdminResolver();
        const resolution = await resolveOrgAdmin?.(projectId);
        resolvedUserId = resolution?.userId;
        organizationId = resolution?.organizationId ?? undefined;
      }

      if (!resolvedUserId) {
        logger.warn({ projectId }, "No user ID available for prompt creation nurturing — skipping");

        return;
      }

      // Get organizationId if we don't have it yet
      if (!organizationId) {
        organizationId = await repository.findOrganizationId(projectId);
      }

      if (!organizationId) {
        logger.warn({ projectId }, "Could not resolve organizationId for prompt count — skipping");

        return;
      }

      // Count org-wide non-deleted prompts with at least one version
      const orgPromptCount = await repository.countOrganizationPrompts(organizationId);

      firePromptCreated({
        userId: resolvedUserId,
        projectId,
        orgPromptCount,
      });
    } catch (error) {
      logger.error({ projectId, error }, "Failed to fire prompt creation nurturing — non-fatal");
      reportFailure(error);
    }
  })();
}
