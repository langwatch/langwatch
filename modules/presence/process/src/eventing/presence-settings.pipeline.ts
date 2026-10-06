/**
 * Presence folds project's and organization's presence-setting facts from its own side (§9),
 * so it holds no project peer. Spec: modules/presence/specs/presence.feature
 */
import {
  defineAggregate,
  defineEventingModule,
  definePipeline,
  type EventingSetup,
  type StaticPipelineDefinition,
} from "@langwatch/eventing";
import {
  ORGANIZATION_PRESENCE_SETTING_CHANGED_EVENT_TYPE,
  organizationPresenceSettingChangedEventDataSchema,
} from "@langwatch/organization-contract";
import {
  PROJECT_CREATED_EVENT_TYPE,
  PROJECT_PRESENCE_SETTING_CHANGED_EVENT_TYPE,
  projectCreatedEventDataSchema,
  projectPresenceSettingChangedEventDataSchema,
} from "@langwatch/project-contract";

import type { PresenceModule } from "../app/presence.app.ts";
import type { PresenceRepositories } from "../repositories/presence.repositories.ts";
import type { PresenceSettingsService } from "../services/presence-settings.service.ts";

export const PRESENCE_SETTINGS_PIPELINE_NAME = "presence_settings" as const;

export type PresenceSettingsPipeline = StaticPipelineDefinition<never>;

export function buildPresenceSettingsPipeline({
  settings,
}: {
  settings: PresenceSettingsService;
}): PresenceSettingsPipeline {
  return (
    definePipeline({
      name: PRESENCE_SETTINGS_PIPELINE_NAME,
      // `global`: presence appends no events of its own; it only folds its peers'.
      aggregate: defineAggregate({ type: "global" }),
    })
      .withEvents([])
      // Every fold is idempotent and newer-wins, so a redelivered fact changes nothing.
      .withPeerSubscriber("presenceProjectCreated", {
        eventType: PROJECT_CREATED_EVENT_TYPE,
        data: projectCreatedEventDataSchema,
        handle: ({ projectId, organizationId }) =>
          settings.projectCreated({ projectId, organizationId }),
      })
      .withPeerSubscriber("presenceProjectSettingChanged", {
        eventType: PROJECT_PRESENCE_SETTING_CHANGED_EVENT_TYPE,
        data: projectPresenceSettingChangedEventDataSchema,
        handle: ({ projectId, organizationId, presenceEnabled, occurredAt }) =>
          settings.projectSettingChanged({
            projectId,
            organizationId,
            presenceEnabled,
            occurredAt,
          }),
      })
      .withPeerSubscriber("presenceOrganizationSettingChanged", {
        eventType: ORGANIZATION_PRESENCE_SETTING_CHANGED_EVENT_TYPE,
        data: organizationPresenceSettingChangedEventDataSchema,
        handle: ({ organizationId, presenceEnabled, occurredAt }) =>
          settings.organizationSettingChanged({ organizationId, presenceEnabled, occurredAt }),
      })
      .build()
  );
}

export const presenceSettingsEventing = defineEventingModule({
  pipeline: PRESENCE_SETTINGS_PIPELINE_NAME,
  build: ({ app }: EventingSetup<PresenceRepositories, PresenceModule>) => app.settingsPipeline(),
});
