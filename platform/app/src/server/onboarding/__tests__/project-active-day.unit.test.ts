/**
 * @vitest-environment node
 *
 * One project_active_day per organization admin per UTC day, remembered in
 * Redis so the trace pipeline never reads Postgres once the day is marked.
 *
 * @see specs/analytics/posthog-guided-onboarding.feature
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  createProjectActiveDayTracker,
  daysSinceSignup,
  PROJECT_ACTIVE_DAY_TTL_SECONDS,
  projectActiveDayKey,
  utcDayOf,
} from "../project-active-day";

const { trackServerEvent } = vi.hoisted(() => ({ trackServerEvent: vi.fn() }));

vi.mock("~/server/posthog", () => ({ trackServerEvent }));

vi.mock("@langwatch/observability", () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

const NOW = Date.UTC(2026, 8, 13, 10, 0, 0);
const THREE_DAYS_AGO = new Date(NOW - 3 * 24 * 60 * 60 * 1000 - 60_000);

function createDeps(
  overrides: { marked?: boolean; variant?: string | null } = {},
) {
  const redis = {
    get: vi.fn().mockResolvedValue(overrides.marked ? "1" : null),
    set: vi.fn().mockResolvedValue("OK"),
  };
  const projects = {
    resolveOrgAdmin: vi.fn().mockResolvedValue({
      userId: "admin_1",
      organizationId: "org_1",
      firstMessage: true,
      onboardingVariant:
        overrides.variant === undefined ? "guided" : overrides.variant,
      organizationCreatedAt: THREE_DAYS_AGO,
    }),
  };
  return { redis, projects };
}

describe("createProjectActiveDayTracker()", () => {
  beforeEach(() => vi.clearAllMocks());

  describe("when the day is not marked yet", () => {
    /** @scenario "the first application trace of a day tracks the project as active" */
    it("tracks project_active_day against the admin with the source, the days since signup and the experiment property", async () => {
      const deps = createDeps();
      const track = createProjectActiveDayTracker(deps);

      await track({ projectId: "project_1", source: "trace", occurredAt: NOW });

      expect(deps.redis.set).toHaveBeenCalledWith(
        "project-active-day:project_1:2026-09-13",
        "1",
        "EX",
        PROJECT_ACTIVE_DAY_TTL_SECONDS,
        "NX",
      );
      expect(trackServerEvent).toHaveBeenCalledWith({
        userId: "admin_1",
        event: "project_active_day",
        projectId: "project_1",
        properties: {
          source: "trace",
          days_since_signup: 3,
          "$feature/experiment_onboarding_langy_guided": "guided",
        },
      });
    });

    /** @scenario "the first successful scenario run of a day tracks the project as active" */
    it("tracks the scenario run source", async () => {
      const deps = createDeps({ variant: null });
      const track = createProjectActiveDayTracker(deps);

      await track({
        projectId: "project_1",
        source: "scenario_run",
        occurredAt: NOW,
      });

      expect(trackServerEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          event: "project_active_day",
          properties: { source: "scenario_run", days_since_signup: 3 },
        }),
      );
    });

    it("tracks nothing when another worker claimed the day first", async () => {
      const deps = createDeps();
      deps.redis.set.mockResolvedValue(null);
      const track = createProjectActiveDayTracker(deps);

      await track({ projectId: "project_1", source: "trace", occurredAt: NOW });

      expect(trackServerEvent).not.toHaveBeenCalled();
    });

    it("tracks nothing and leaves the day unmarked when the project has no admin", async () => {
      const deps = createDeps();
      deps.projects.resolveOrgAdmin.mockResolvedValue({
        userId: null,
        organizationId: null,
        firstMessage: false,
        onboardingVariant: null,
        organizationCreatedAt: null,
      });
      const track = createProjectActiveDayTracker(deps);

      await track({ projectId: "project_1", source: "trace", occurredAt: NOW });

      expect(deps.redis.set).not.toHaveBeenCalled();
      expect(trackServerEvent).not.toHaveBeenCalled();
    });
  });

  describe("when the day is already marked", () => {
    /** @scenario "a second trace on the same day tracks nothing more" */
    it("tracks nothing and reads no admin", async () => {
      const deps = createDeps({ marked: true });
      const track = createProjectActiveDayTracker(deps);

      await track({ projectId: "project_1", source: "trace", occurredAt: NOW });

      expect(deps.redis.get).toHaveBeenCalledWith(
        "project-active-day:project_1:2026-09-13",
      );
      expect(deps.projects.resolveOrgAdmin).not.toHaveBeenCalled();
      expect(deps.redis.set).not.toHaveBeenCalled();
      expect(trackServerEvent).not.toHaveBeenCalled();
    });
  });

  describe("when Redis fails", () => {
    it("returns normally and tracks nothing", async () => {
      const deps = createDeps();
      deps.redis.get.mockRejectedValue(new Error("redis down"));
      const track = createProjectActiveDayTracker(deps);

      await expect(
        track({ projectId: "project_1", source: "trace", occurredAt: NOW }),
      ).resolves.toBeUndefined();
      expect(trackServerEvent).not.toHaveBeenCalled();
    });
  });
});

describe("the day arithmetic", () => {
  it("names the UTC day and the key per project and day", () => {
    expect(utcDayOf(Date.UTC(2026, 8, 13, 23, 59, 59))).toBe("2026-09-13");
    expect(utcDayOf(Date.UTC(2026, 8, 14, 0, 0, 1))).toBe("2026-09-14");
    expect(projectActiveDayKey({ projectId: "p", day: "2026-09-13" })).toBe(
      "project-active-day:p:2026-09-13",
    );
  });

  it("counts whole days since signup and never goes below zero", () => {
    const createdAt = new Date(NOW);
    expect(daysSinceSignup({ createdAt, at: NOW })).toBe(0);
    expect(daysSinceSignup({ createdAt, at: NOW + 47 * 60 * 60 * 1000 })).toBe(
      1,
    );
    expect(daysSinceSignup({ createdAt, at: NOW - 1000 })).toBe(0);
  });
});
