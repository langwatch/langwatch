/**
 * @vitest-environment node
 * Presence folds project's and organization's presence-setting facts through its own peer
 * subscribers, so it keeps no project peer. Spec: modules/presence/specs/presence.feature
 */
import { EventSourcing, InMemoryProcessStore } from "@langwatch/eventing";
import { EventStoreMemory } from "@langwatch/eventing/testing";
import { ORGANIZATION_PRESENCE_SETTING_CHANGED_EVENT_TYPE } from "@langwatch/organization-contract";
import {
  PROJECT_CREATED_EVENT_TYPE,
  PROJECT_PRESENCE_SETTING_CHANGED_EVENT_TYPE,
} from "@langwatch/project-contract";
import { describe, expect, it, vi } from "vitest";

import { MemoryPresenceSettingsRepository } from "../../repositories/memory/memory.presence-settings.repository.ts";
import { PresenceSettingsService } from "../../services/presence-settings.service.ts";
import { buildPresenceSettingsPipeline } from "../presence-settings.pipeline.ts";
import { settingsFactOwner } from "./presence-settings.fixture.ts";

const PROJECT_ID = "project-1";
const ORGANIZATION_ID = "organization-1";

function harness() {
  const repository = MemoryPresenceSettingsRepository.create();
  const settings = PresenceSettingsService.create({ repository });
  const eventing = new EventSourcing({
    eventStore: EventStoreMemory.createForTesting(),
    processStore: InMemoryProcessStore.createForTesting(),
  });
  const append = settingsFactOwner(eventing);
  eventing.register(buildPresenceSettingsPipeline({ settings }));
  return { eventing, append, repository, settings };
}

describe("given presence's settings pipeline beside project's and organization's facts", () => {
  describe("when project records a creation and an on setting, then organization switches off", () => {
    /** @scenario "Presence folds the presence-setting facts project and organization append" */
    it("folds each fact and answers that the project is not enabled", async () => {
      const { eventing, append, repository, settings } = harness();

      await append(
        {
          type: PROJECT_CREATED_EVENT_TYPE,
          data: {
            tenantId: PROJECT_ID,
            projectId: PROJECT_ID,
            organizationId: ORGANIZATION_ID,
            occurredAt: 10,
          },
        },
        "event-created",
      );
      await append(
        {
          type: PROJECT_PRESENCE_SETTING_CHANGED_EVENT_TYPE,
          data: {
            tenantId: PROJECT_ID,
            projectId: PROJECT_ID,
            organizationId: ORGANIZATION_ID,
            occurredAt: 20,
            presenceEnabled: true,
          },
        },
        "event-project-on",
      );
      await vi.waitFor(async () =>
        expect(await repository.getProject({ projectId: PROJECT_ID })).toEqual({
          kind: "folded",
          organizationId: ORGANIZATION_ID,
          setting: "on",
        }),
      );
      await expect(settings.isEnabledForProject({ projectId: PROJECT_ID })).resolves.toBe(true);

      await append(
        {
          type: ORGANIZATION_PRESENCE_SETTING_CHANGED_EVENT_TYPE,
          data: {
            tenantId: ORGANIZATION_ID,
            organizationId: ORGANIZATION_ID,
            occurredAt: 30,
            presenceEnabled: false,
          },
        },
        "event-organization-off",
      );

      await vi.waitFor(async () =>
        expect(await repository.getOrganizationSetting({ organizationId: ORGANIZATION_ID })).toBe(
          "off",
        ),
      );
      await expect(settings.isEnabledForProject({ projectId: PROJECT_ID })).resolves.toBe(false);
      await eventing.close();
    });
  });
});
