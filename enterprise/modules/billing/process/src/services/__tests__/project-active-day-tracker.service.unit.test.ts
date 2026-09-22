/**
 * One `project_active_day` event per project per UTC day, against the
 * resolved admin, with the experiment property attached.
 * @see specs/features/customer-io-nurturing-integration.feature
 */
import { Temporal } from "@langwatch/time";
import { describe, expect, it } from "vitest";

import { MemoryPostHogChannel } from "../../channels/memory/memory.posthog.channel.ts";
import { MemoryProjectActiveDayRepository } from "../../repositories/memory/memory.project-active-day.repository.ts";
import {
  ProjectActiveDayTrackerService,
  type ProjectAdminResolution,
} from "../project-active-day-tracker.service.ts";

const OCCURRED_AT = Date.UTC(2026, 8, 13, 10, 0, 0);

function admin(overrides: Partial<ProjectAdminResolution> = {}): ProjectAdminResolution {
  return {
    userId: "admin-1",
    organizationId: "org-1",
    onboardingVariant: "classic",
    organizationCreatedAt: Temporal.Instant.fromEpochMilliseconds(Date.UTC(2026, 8, 1)),
    ...overrides,
  };
}

function createTracker(resolution: ProjectAdminResolution | null = admin()) {
  const posthog = MemoryPostHogChannel.create();
  const repository = MemoryProjectActiveDayRepository.create();
  const tracker = ProjectActiveDayTrackerService.create({
    posthog,
    repository,
    resolveOrgAdmin: async () => resolution,
  });
  return { posthog, repository, tracker };
}

describe("ProjectActiveDayTrackerService", () => {
  describe("when the day has not been claimed yet", () => {
    /** @scenario "the first signal of the day tracks the project's active day" */
    it("tracks project_active_day with days_since_signup and the experiment property", async () => {
      const { posthog, tracker } = createTracker();

      await tracker.track({
        projectId: "project-1",
        source: "scenario_run",
        occurredAt: OCCURRED_AT,
      });

      expect(posthog.tracked).toEqual([
        {
          userId: "admin-1",
          event: "project_active_day",
          properties: {
            source: "scenario_run",
            days_since_signup: 12,
            "$feature/experiment_onboarding_langy_guided": "control",
          },
        },
      ]);
    });
  });

  describe("when a second signal lands the same UTC day", () => {
    /** @scenario "subsequent signals the same day do not re-track" */
    it("tracks nothing", async () => {
      const { posthog, tracker } = createTracker();

      await tracker.track({ projectId: "project-1", source: "trace", occurredAt: OCCURRED_AT });
      await tracker.track({
        projectId: "project-1",
        source: "scenario_run",
        occurredAt: OCCURRED_AT + 1000,
      });

      expect(posthog.tracked).toHaveLength(1);
    });
  });

  describe("when the project has no admin", () => {
    it("claims the day but tracks nothing", async () => {
      const { posthog, repository, tracker } = createTracker(null);

      await tracker.track({ projectId: "project-1", source: "trace", occurredAt: OCCURRED_AT });

      expect(posthog.tracked).toHaveLength(0);
      expect(await repository.claimDay({ projectId: "project-1", day: "2026-09-13" })).toBe(false);
    });
  });
});
