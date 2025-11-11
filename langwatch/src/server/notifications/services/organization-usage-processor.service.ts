import type { PrismaClient } from "@prisma/client";
import { createLogger } from "../../../utils/logger";
import { UsageLimitService } from "../usage-limit.service";
import * as Sentry from "@sentry/nextjs";
import type { ProcessResult } from "../types/process-result";

const logger = createLogger("langwatch:notifications:processor");

/**
 * Service for processing usage limit checks across organizations
 * Single Responsibility: Orchestrate automated cron workflow
 * 
 * Used by: Cron job (trace_analytics) for automated daily checks
 * Not used by: Manual API endpoints (those call UsageLimitService directly)
 */
export class OrganizationUsageProcessorService {
  private readonly usageLimitService: UsageLimitService;

  constructor(private readonly prisma: PrismaClient) {
    this.usageLimitService = UsageLimitService.create(prisma);
  }

  /**
   * Process usage for a single organization
   * Delegates all logic to UsageLimitService
   */
  async processOrganization(organizationId: string): Promise<ProcessResult> {
    try {
      const notification = await this.usageLimitService.checkAndSendWarning({
        organizationId,
      });

      return {
        organizationId,
        notificationSent: notification !== null,
      };
    } catch (error) {
      logger.error(
        { error, organizationId },
        "Error processing organization usage",
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
   * Process all organizations in batch
   * Used by automated cron job
   */
  async processAllOrganizations(): Promise<ProcessResult[]> {
    const organizations = await this.prisma.organization.findMany({
      select: {
        id: true,
      },
    });

    logger.info(
      { count: organizations.length },
      "Starting automated usage check for all organizations",
    );

    const results = await Promise.all(
      organizations.map((org) => this.processOrganization(org.id)),
    );

    const sentCount = results.filter((r) => r.notificationSent).length;
    const errorCount = results.filter((r) => r.error).length;

    logger.info(
      {
        total: organizations.length,
        notificationsSent: sentCount,
        errors: errorCount,
      },
      "Completed automated usage check",
    );

    return results;
  }
}

