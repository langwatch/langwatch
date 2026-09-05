import {
  reportNurturingFailure,
  tryNurturingOrganizationAdminResolver,
  tryNurturingSink,
} from "./nurturing-sink";
import { createLogger } from "@langwatch/observability";
import type { PrismaClient } from "@langwatch/prisma-client/generated";

const logger = createLogger("ee:nurturing:prompt-creation");

export class NurturingPromptCreationService {
  static create(): NurturingPromptCreationService {
    return new NurturingPromptCreationService();
  }

  /**
   * @param userId - The org admin user ID
   * @param projectId - The project where the prompt was created
   * @param orgPromptCount - The org-wide prompt count AFTER the prompt was created
   */
  static firePromptCreated({
    userId,
    projectId,
    orgPromptCount,
  }: {
    userId: string;
    projectId: string;
    orgPromptCount: number;
  }): void {
    const nurturing = tryNurturingSink();
    if (!nurturing) {
      return;
    }

    void nurturing
      .identifyUser({
        userId,
        traits: { has_prompts: true, prompt_count: orgPromptCount },
      })
      .catch(reportNurturingFailure);

    if (orgPromptCount === 1) {
      void nurturing
        .trackEvent({
          userId,
          event: "first_prompt_created",
          properties: { project_id: projectId },
        })
        .catch(reportNurturingFailure);
    }
  }

  /**
   * @param prisma - PrismaClient for database queries
   * @param projectId - The project where the prompt was created
   * @param userId - The user who created the prompt (optional; resolved via resolveOrgAdmin if missing)
   */
  static afterPromptCreated({
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
          const resolveOrgAdmin = tryNurturingOrganizationAdminResolver();
          const resolution = await resolveOrgAdmin?.(projectId);
          resolvedUserId = resolution?.userId;
          organizationId = resolution?.organizationId ?? undefined;
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

        NurturingPromptCreationService.firePromptCreated({
          userId: resolvedUserId,
          projectId,
          orgPromptCount,
        });
      } catch (error) {
        logger.error({ projectId, error }, "Failed to fire prompt creation nurturing — non-fatal");
        reportNurturingFailure(error);
      }
    })();
  }
}
