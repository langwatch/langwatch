/**
 * Presence answers whether it is on from the rows project and organization hold, read through
 * their shares (R40), never from a fold of their facts.
 * @see modules/presence/specs/presence.feature
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  createPresenceTestApp,
  createPresenceTestRepositories,
} from "../../app/__tests__/presence.fixture.ts";
import { MemoryPresenceSettingsRepository } from "../../repositories/memory/memory.presence-settings.repository.ts";
import { PRESENCE_SETTINGS_TTL_MS, PresenceSettingsService } from "../presence-settings.service.ts";

const heartbeat = {
  projectId: "project-1",
  sessionId: "tab-1",
  location: { lens: "traces", route: {} },
  user: { id: "user-1", name: "Ada", image: null },
} as const;

function ownersRows({ project, organization }: { project: boolean; organization: boolean }) {
  const repository = MemoryPresenceSettingsRepository.create({
    projects: new Map([["project-1", { teamId: "team-1", presenceEnabled: project }]]),
    teams: new Map([["team-1", { organizationId: "org-1" }]]),
    organizations: new Map([["org-1", { presenceEnabled: organization }]]),
  });
  return PresenceSettingsService.create({ repository });
}

describe("given the project's and its organization's settings as their owners hold them", () => {
  /** @scenario "A project is enabled only when its own setting and its organization's are both on" */
  it.each([
    { project: true, organization: true, enabled: true },
    { project: true, organization: false, enabled: false },
    { project: false, organization: true, enabled: false },
    { project: false, organization: false, enabled: false },
  ])(
    "answers $enabled for project $project and organization $organization",
    async ({ project, organization, enabled }) => {
      const settings = ownersRows({ project, organization });

      await expect(settings.isEnabledForProject({ projectId: "project-1" })).resolves.toBe(enabled);
    },
  );
});

describe("given project holds no project with that id", () => {
  /** @scenario "A project its owner does not hold is not enabled" */
  it("answers that the project is not enabled", async () => {
    const settings = ownersRows({ project: true, organization: true });

    await expect(settings.isEnabledForProject({ projectId: "project-unknown" })).resolves.toBe(
      false,
    );
  });
});

describe("given project holds the project in a team organization does not hold", () => {
  /** @scenario "A project whose team its owner does not hold is not enabled" */
  it("answers that the project is not enabled", async () => {
    const settings = PresenceSettingsService.create({
      repository: MemoryPresenceSettingsRepository.create({
        projects: new Map([["project-1", { teamId: "team-gone", presenceEnabled: true }]]),
      }),
    });

    await expect(settings.isEnabledForProject({ projectId: "project-1" })).resolves.toBe(false);
  });
});

describe("given presence answered that a project is enabled", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  describe("when organization switches the organization's presence setting off", () => {
    /** @scenario "A settings toggle may lag up to 30 seconds, and the next request after that sees it" */
    it("may answer enabled within 30 s, then answers not enabled and stores no session", async () => {
      vi.useFakeTimers({ toFake: ["Date"], now: 1_000_000 });
      const organizations = new Map([["org-1", { presenceEnabled: true }]]);
      const presence = await createPresenceTestApp({
        repositories: {
          ...(await createPresenceTestRepositories()),
          settings: MemoryPresenceSettingsRepository.create({
            projects: new Map([["project-1", { teamId: "team-1", presenceEnabled: true }]]),
            teams: new Map([["team-1", { organizationId: "org-1" }]]),
            organizations,
          }),
        },
      });
      await expect(presence.isEnabledForProject({ projectId: "project-1" })).resolves.toBe(true);

      organizations.set("org-1", { presenceEnabled: false });
      vi.setSystemTime(1_000_000 + PRESENCE_SETTINGS_TTL_MS - 1);
      await expect(presence.isEnabledForProject({ projectId: "project-1" })).resolves.toBe(true);

      vi.setSystemTime(1_000_000 + PRESENCE_SETTINGS_TTL_MS);
      await expect(presence.isEnabledForProject({ projectId: "project-1" })).resolves.toBe(false);
      await presence.update(heartbeat);
      await expect(presence.list({ projectId: "project-1" })).resolves.toEqual([]);
    });
  });
});

describe("given presence answered whether a project is enabled", () => {
  describe("when further requests for the project arrive within 30 seconds", () => {
    /** @scenario "Within the window presence reads the owners' rows once per project" */
    it("reads the owners' rows once", async () => {
      let at = 0;
      const repository = MemoryPresenceSettingsRepository.create();
      const getSettings = vi.spyOn(repository, "getSettings");
      const settings = PresenceSettingsService.create({ repository, now: () => at });

      await settings.isEnabledForProject({ projectId: "project-1" });
      at = PRESENCE_SETTINGS_TTL_MS - 1;
      await settings.isEnabledForProject({ projectId: "project-1" });

      expect(getSettings).toHaveBeenCalledTimes(1);
    });
  });
});
