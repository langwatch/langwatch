/**
 * One `project_active_day` event per organization admin per UTC day: the
 * first application trace of the day or the first successful scenario run,
 * whichever lands first. Redis remembers the day per project, so the trace
 * pipeline pays one Redis read per trace and never a Postgres read once the
 * day is marked.
 *
 * @see specs/analytics/posthog-guided-onboarding.feature
 */
import { createLogger } from "@langwatch/observability";
import type { OrgAdminResolution } from "~/server/app-layer/projects/project.service";
import { trackServerEvent } from "~/server/posthog";
import { onboardingExperimentProperties } from "./guided-onboarding.experiment";

const logger = createLogger("langwatch:onboarding:project-active-day");

export const PROJECT_ACTIVE_DAY_TTL_SECONDS = 2 * 24 * 60 * 60;

export type ProjectActiveDaySource = "trace" | "scenario_run";

export interface ProjectActiveDayRedis {
  get(key: string): Promise<string | null>;
  set(
    key: string,
    value: string,
    expiryMode: "EX",
    seconds: number,
    condition: "NX",
  ): Promise<string | null>;
}

export interface ProjectActiveDayDeps {
  redis: ProjectActiveDayRedis;
  projects: {
    resolveOrgAdmin(projectId: string): Promise<OrgAdminResolution>;
  };
}

export type ProjectActiveDayTracker = (args: {
  projectId: string;
  source: ProjectActiveDaySource;
  occurredAt: number;
}) => Promise<void>;

const DAY_MS = 24 * 60 * 60 * 1000;

/** The UTC calendar day of an instant, as YYYY-MM-DD. */
export function utcDayOf(at: number): string {
  return new Date(at).toISOString().slice(0, 10);
}

export function projectActiveDayKey({
  projectId,
  day,
}: {
  projectId: string;
  day: string;
}): string {
  return `project-active-day:${projectId}:${day}`;
}

/** Whole days between the organization's creation and the instant. */
export function daysSinceSignup({
  createdAt,
  at,
}: {
  createdAt: Date;
  at: number;
}): number {
  return Math.max(0, Math.floor((at - createdAt.getTime()) / DAY_MS));
}

/**
 * Never throws: a failed read or write means the day is simply not tracked
 * from this call, and the next signal of the day tries again.
 */
export function createProjectActiveDayTracker(
  deps: ProjectActiveDayDeps,
): ProjectActiveDayTracker {
  return async ({ projectId, source, occurredAt }) => {
    const key = projectActiveDayKey({ projectId, day: utcDayOf(occurredAt) });
    try {
      if ((await deps.redis.get(key)) !== null) return;

      const { userId, onboardingVariant, organizationCreatedAt } =
        await deps.projects.resolveOrgAdmin(projectId);
      if (!userId) return;

      const claimed = await deps.redis.set(
        key,
        "1",
        "EX",
        PROJECT_ACTIVE_DAY_TTL_SECONDS,
        "NX",
      );
      if (claimed !== "OK") return;

      trackServerEvent({
        userId,
        event: "project_active_day",
        projectId,
        properties: {
          source,
          ...(organizationCreatedAt
            ? {
                days_since_signup: daysSinceSignup({
                  createdAt: organizationCreatedAt,
                  at: occurredAt,
                }),
              }
            : {}),
          ...onboardingExperimentProperties(onboardingVariant),
        },
      });
    } catch (error) {
      logger.error(
        { projectId, source, error },
        "Failed to track the project's active day, retried on the next signal",
      );
    }
  };
}
