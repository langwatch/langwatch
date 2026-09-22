import { createLogger } from "@langwatch/observability";
import {
  onboardingExperimentProperties,
  type OnboardingVariant,
} from "@langwatch/onboarding-contract";
import { differenceInDays, Temporal, type Instant } from "@langwatch/time";

import type { PostHogChannel } from "../channels/posthog.channel.ts";
import type { ProjectActiveDayRepository } from "../repositories/project-active-day.repository.ts";

const logger = createLogger("langwatch:billing:project-active-day");

export type ProjectActiveDaySource = "trace" | "scenario_run";

/** What a project's admin resolves to, for the milestones this tracker and its callers fire. */
export interface ProjectAdminResolution {
  userId: string;
  organizationId: string;
  onboardingVariant: OnboardingVariant | null;
  organizationCreatedAt: Instant | null;
}

export interface ProjectActiveDayTrackerDeps {
  repository: ProjectActiveDayRepository;
  posthog: PostHogChannel;
  /** The peer read on OrganizationApi, composed and injected at boot. */
  resolveOrgAdmin: (projectId: string) => Promise<ProjectAdminResolution | null>;
}

/** The UTC calendar day of an instant, as YYYY-MM-DD. */
function utcDayOf(at: number): string {
  return Temporal.Instant.fromEpochMilliseconds(at)
    .toZonedDateTimeISO("UTC")
    .toPlainDate()
    .toString();
}

/**
 * One `project_active_day` event per admin per UTC day: the first trace or
 * scenario run, whichever lands first.
 * @see specs/features/customer-io-nurturing-integration.feature
 */
export class ProjectActiveDayTrackerService {
  private constructor(private readonly deps: ProjectActiveDayTrackerDeps) {}

  static create(deps: ProjectActiveDayTrackerDeps): ProjectActiveDayTrackerService {
    return new ProjectActiveDayTrackerService(deps);
  }

  async track({
    projectId,
    source,
    occurredAt,
  }: {
    projectId: string;
    source: ProjectActiveDaySource;
    occurredAt: number;
  }): Promise<void> {
    try {
      const day = utcDayOf(occurredAt);
      const claimed = await this.deps.repository.claimDay({ projectId, day });
      if (!claimed) return;

      const admin = await this.deps.resolveOrgAdmin(projectId);
      if (!admin?.userId) return;

      this.deps.posthog.track({
        userId: admin.userId,
        event: "project_active_day",
        properties: {
          source,
          ...(admin.organizationCreatedAt
            ? {
                days_since_signup: Math.max(
                  0,
                  differenceInDays(occurredAt, admin.organizationCreatedAt.epochMilliseconds, {
                    timeZone: "UTC",
                  }),
                ),
              }
            : {}),
          ...onboardingExperimentProperties(admin.onboardingVariant),
        },
      });
    } catch (error) {
      logger.error(
        { projectId, source, error },
        "Failed to track the project's active day, retried on the next signal",
      );
    }
  }
}
