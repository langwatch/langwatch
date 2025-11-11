import type { PrismaClient } from "@prisma/client";
import { createLogger } from "../../../utils/logger";
import { UsageLimitService } from "../usage-limit.service";
import { dependencies } from "../../../injection/dependencies.server";
import * as Sentry from "@sentry/nextjs";

const logger = createLogger("langwatch:notifications:usageChecker");

interface OrganizationUsageResult {
  organizationId: string;
  notificationSent: boolean;
  error?: Error;
}

/**
 * Service for checking usage limits across organizations
 * Single Responsibility: Orchestrate usage checking for multiple organizations
 */
export class OrganizationUsageCheckerService {
  private readonly usageLimitService: UsageLimitService;

  constructor(private readonly prisma: PrismaClient) {
    this.usageLimitService = UsageLimitService.create(prisma);
  }

  /**
   * Get projects for an organization
   */
  private async getOrganizationProjects(
    organizationId: string,
  ): Promise<string[]> {
    const projects = await this.prisma.project.findMany({
      where: {
        team: { organizationId },
      },
      select: {
        id: true,
      },
    });

    return projects.map((p) => p.id);
  }

  /**
   * Get current month message count for projects
   */
  private async getCurrentMonthMessagesCount(
    projectIds: string[],
  ): Promise<number> {
    // This is imported from limits.ts router - ideally should be in a shared service
    // but for now we'll keep the dependency
    const { getCurrentMonthMessagesCount } = await import(
      "../../api/routers/limits"
    );
    return getCurrentMonthMessagesCount(projectIds);
  }

  /**
   * Check usage limits for a single organization
   */
  async checkOrganizationUsage(
    organizationId: string,
  ): Promise<OrganizationUsageResult> {
    try {
      // Get projects
      const projectIds = await this.getOrganizationProjects(organizationId);
      if (projectIds.length === 0) {
        logger.debug(
          { organizationId },
          "Organization has no projects, skipping",
        );
        return { organizationId, notificationSent: false };
      }

      // Get current usage
      const currentMonthMessagesCount =
        await this.getCurrentMonthMessagesCount(projectIds);

      // Get plan limits
      const activePlan =
        await dependencies.subscriptionHandler.getActivePlan(organizationId);

      if (
        !activePlan ||
        typeof activePlan.maxMessagesPerMonth !== "number" ||
        activePlan.maxMessagesPerMonth <= 0
      ) {
        logger.debug(
          { organizationId },
          "Invalid or missing plan configuration, skipping",
        );
        return { organizationId, notificationSent: false };
      }

      // Log usage info
      const usagePercentage =
        (currentMonthMessagesCount / activePlan.maxMessagesPerMonth) * 100;

      if (currentMonthMessagesCount > 1) {
        logger.info(
          {
            organizationId,
            currentMonthMessagesCount,
            maxMessagesPerMonth: activePlan.maxMessagesPerMonth,
            usagePercentage: usagePercentage.toFixed(1),
            projectCount: projectIds.length,
          },
          "Checking organization usage",
        );
      }

      // Check and send warning if needed
      const notification = await this.usageLimitService.checkAndSendWarning({
        organizationId,
        currentMonthMessagesCount,
        maxMonthlyUsageLimit: activePlan.maxMessagesPerMonth,
      });

      return {
        organizationId,
        notificationSent: notification !== null,
      };
    } catch (error) {
      logger.error(
        { error, organizationId },
        "Error checking usage for organization",
      );
      Sentry.captureException(error, {
        extra: { organizationId },
      });
      return {
        organizationId,
        notificationSent: false,
        error: error instanceof Error ? error : new Error(String(error)),
      };
    }
  }

  /**
   * Check usage limits for all organizations
   */
  async checkAllOrganizations(): Promise<OrganizationUsageResult[]> {
    const organizations = await this.prisma.organization.findMany({
      select: {
        id: true,
      },
    });

    logger.info(
      { count: organizations.length },
      "Starting usage check for all organizations",
    );

    const results = await Promise.all(
      organizations.map((org) => this.checkOrganizationUsage(org.id)),
    );

    const sentCount = results.filter((r) => r.notificationSent).length;
    const errorCount = results.filter((r) => r.error).length;

    logger.info(
      {
        total: organizations.length,
        notificationsSent: sentCount,
        errors: errorCount,
      },
      "Completed usage check for all organizations",
    );

    return results;
  }
}

