/**
 * Presence answers whether it is on from its own fold of project's and organization's
 * presence-setting facts, never from a peer.
 * @see modules/presence/specs/presence.feature
 */
import { beforeEach, describe, expect, it } from "vitest";

import { MemoryPresenceSettingsRepository } from "../../repositories/memory/memory.presence-settings.repository.ts";
import { PresenceSettingsService } from "../presence-settings.service.ts";

const PROJECT = { projectId: "project-1", organizationId: "org-1" };

let settings: PresenceSettingsService;

beforeEach(() => {
  settings = PresenceSettingsService.create({
    repository: MemoryPresenceSettingsRepository.create(),
  });
});

describe("given the project's and its organization's folded presence settings", () => {
  /** @scenario "A project is enabled only when its folded setting and its organization's are both on" */
  it.each([
    { project: true, organization: true, enabled: true },
    { project: true, organization: false, enabled: false },
    { project: false, organization: true, enabled: false },
    { project: false, organization: false, enabled: false },
  ])(
    "answers $enabled for project $project and organization $organization",
    async ({ project, organization, enabled }) => {
      await settings.projectSettingChanged({ ...PROJECT, presenceEnabled: project, occurredAt: 1 });
      await settings.organizationSettingChanged({
        organizationId: PROJECT.organizationId,
        presenceEnabled: organization,
        occurredAt: 1,
      });

      await expect(settings.isEnabledForProject({ projectId: PROJECT.projectId })).resolves.toBe(
        enabled,
      );
    },
  );
});

describe("given presence has folded nothing about a project", () => {
  /** @scenario "A project presence has folded no fact for is not enabled" */
  it("answers that the project is not enabled", async () => {
    await expect(settings.isEnabledForProject({ projectId: "project-unknown" })).resolves.toBe(
      false,
    );
  });
});

describe("given presence has folded only a project's creation", () => {
  /** @scenario "A created project with no recorded settings is enabled, as the stored defaults are" */
  it("answers that the project is enabled", async () => {
    await settings.projectCreated(PROJECT);

    await expect(settings.isEnabledForProject({ projectId: PROJECT.projectId })).resolves.toBe(
      true,
    );
  });
});

describe("given presence has folded the project's and organization's settings as off", () => {
  beforeEach(async () => {
    await settings.projectSettingChanged({ ...PROJECT, presenceEnabled: false, occurredAt: 20 });
    await settings.organizationSettingChanged({
      organizationId: PROJECT.organizationId,
      presenceEnabled: false,
      occurredAt: 20,
    });
  });

  /** @scenario "A presence setting older than the one folded does not overwrite it" */
  it("keeps them off when older settings turning them on arrive late", async () => {
    await settings.projectSettingChanged({ ...PROJECT, presenceEnabled: true, occurredAt: 10 });
    await settings.organizationSettingChanged({
      organizationId: PROJECT.organizationId,
      presenceEnabled: true,
      occurredAt: 10,
    });
    await settings.projectCreated(PROJECT);

    await expect(settings.isEnabledForProject({ projectId: PROJECT.projectId })).resolves.toBe(
      false,
    );
  });

  /** @scenario "Folding the same presence-setting fact twice changes nothing" */
  it("still answers not enabled when the same fact is delivered again", async () => {
    await settings.projectSettingChanged({ ...PROJECT, presenceEnabled: false, occurredAt: 20 });

    await expect(settings.isEnabledForProject({ projectId: PROJECT.projectId })).resolves.toBe(
      false,
    );
  });
});
