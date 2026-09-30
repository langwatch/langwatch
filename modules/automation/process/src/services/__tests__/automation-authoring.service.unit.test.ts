import { createApiFixture } from "@langwatch/api-fixture";
import type { Trigger } from "@langwatch/automation-contract";
/**
 * @vitest-environment node
 * The authoring behaviour the tRPC transport used to carry: daily-cap
 * status and what resuming a paused automation writes. Both are the
 * application's now, so REST reaches the same answers.
 * @see specs/automations/runaway-automation-containment.feature
 */
import type { FeatureFlagApi } from "@langwatch/feature-flag-contract";
import type { MonitorApi } from "@langwatch/monitor-contract";
import type { ProjectApi } from "@langwatch/project-contract";
import { describe, expect, it, vi } from "vitest";

import { AutomationAuthoringService } from "../automation-authoring.service.ts";
import { AutomationProviderRegistryService } from "../automation-provider-registry.service.ts";
import { AutomationRulesService } from "../automation-rules.service.ts";
import type { AutomationService } from "../automation.service.ts";

/** The authoring service over exactly the reads and writes a case names. */
function authoring(
  automation: Partial<AutomationService>,
  providers?: AutomationProviderRegistryService,
) {
  const service = createApiFixture<AutomationService>(automation);
  const rules = AutomationRulesService.create({
    automation: service,
    projects: createApiFixture<ProjectApi>({
      findSummaryById: async () => ({ name: "Test", slug: "test" }),
    }),
    featureFlags: createApiFixture<FeatureFlagApi>({ isEnabled: async () => true }),
  });

  return AutomationAuthoringService.create({
    automation: service,
    rules,
    monitors: createApiFixture<MonitorApi>({ getAllByIds: async () => [] }),
    providers: providers ?? {
      actionParamsSchemaFor: () => ({ safeParse: (data: unknown) => ({ success: true, data }) }),
      persistActionParamsFor: async (_action, args) => args.incoming,
      redactActionParamsFor: (_action, params) => params,
      findDecryptedSlackBotToken: () => null,
      decryptWebhookHeaders: () => ({}),
      decryptWebhookSigningSecrets: () => [],
    },
    slackChannels: { list: async () => ({ channels: [], error: null, gaps: [] }) },
    traceFilters: { assertCompiles: () => undefined },
    limits: { count: async () => ({ allowed: true, resetAt: 0 }) },
  });
}

describe("given the daily persist ceiling", () => {
  describe("when a project has more automations than one request used to carry", () => {
    /** @scenario "Every automation on the list reports what it skipped" */
    it("still reports the later automation's skipped count", async () => {
      const ids = Array.from({ length: 60 }, (_, index) => `trigger-${index}`);
      const service = authoring({
        resolvePersistDailyCap: async () => 100,
        getAllForProject: async () => ids.map((id) => ({ id })) as never,
        readPersistCapCounts: async ({ triggerIds }) =>
          Object.fromEntries(
            triggerIds.map((id) => [id, { count: 0, skipped: id === "trigger-59" ? 12 : 0 }]),
          ),
      });

      const result = await service.readDailyCapStatus({ projectId: "project-1" });

      expect(Object.keys(result.counts)).toHaveLength(60);
      expect(result.counts["trigger-59"]).toMatchObject({ skipped: 12 });
    });
  });

  describe("when a trigger skipped matches today", () => {
    /** @scenario "The automations list shows what was skipped today" */
    it("shows how many matches the trigger skipped today", async () => {
      const service = authoring({
        resolvePersistDailyCap: async () => 100,
        getAllForProject: async () => [{ id: "trigger-1" }] as never,
        readPersistCapCounts: async () => ({ "trigger-1": { count: 4, skipped: 4 } }),
      });

      const result = await service.readDailyCapStatus({ projectId: "project-1" });

      expect(result.counts["trigger-1"]).toMatchObject({ skipped: 4 });
    });
  });
});

describe("given a trigger paused for runaway volume", () => {
  describe("when the customer re-enables it", () => {
    /** @scenario "Resuming a paused automation clears the pause reason" */
    it("clears the pause reason and pause time in the same write", async () => {
      const update = vi.fn().mockResolvedValue(resumedTrigger());
      const service = authoring({
        findById: async () => resumedTrigger(),
        update,
      });

      await service.setActive({
        projectId: "project-1",
        triggerId: "trigger-1",
        active: true,
      });

      expect(update).toHaveBeenCalledWith(
        expect.objectContaining({ active: true, pausedReason: null, pausedAt: null }),
      );
    });
  });
});

/** The row a resumed automation reads back as. */
function resumedTrigger(): Trigger {
  return {
    id: "trigger-1",
    projectId: "project-1",
    name: "Nightly digest",
    action: "SEND_EMAIL",
    triggerKind: "AUTOMATION",
    actionParams: {},
    filters: {},
    filterQuery: null,
    active: true,
    deleted: false,
    pausedReason: null,
    pausedAt: null,
    message: null,
    alertType: null,
    customGraphId: null,
    notificationCadence: "immediate",
    traceDebounceMs: 0,
    templates: {
      slackTemplateType: null,
      slackTemplate: null,
      emailSubjectTemplate: null,
      emailBodyTemplate: null,
    },
    createdAt: new Date(0),
    updatedAt: new Date(0),
    lastRunAt: null,
  };
}

/** Reversible and obviously not real, so a plaintext leak is loud. */
const cipher = {
  encrypt: (plain: string) => `enc(${plain})`,
  decrypt: (c: string) => c.replace(/^enc\(/, "").replace(/\)$/, ""),
};

describe("given a stored annotation queue automation", () => {
  describe("when a REST edit replaces its delivery settings", () => {
    /** @scenario "A REST edit cannot re-attribute an automation to another user" */
    it("keeps the stored creator and ignores a submitted one", async () => {
      const update = vi
        .fn()
        .mockImplementation(async (command) => ({ ...queueTrigger(), ...command }));
      const service = authoring(
        { findById: async () => queueTrigger(), update },
        AutomationProviderRegistryService.create(cipher),
      );

      await service.update({
        id: "trigger-1",
        projectId: "project-1",
        actionParams: {
          annotators: [{ id: "user_new", name: "New" }],
          createdByUserId: "user_victim",
        },
      });

      expect(update).toHaveBeenCalledWith(
        expect.objectContaining({
          actionParams: {
            annotators: [{ id: "user_new", name: "New" }],
            createdByUserId: "user_owner",
          },
        }),
      );
    });
  });

  describe("when a REST edit replaces a webhook's delivery settings", () => {
    /** @scenario "A REST edit replaces an automation's delivery settings" */
    it("stores the header values encrypted, never in plaintext", async () => {
      const update = vi
        .fn()
        .mockImplementation(async (command) => ({ ...webhookTrigger(), ...command }));
      const service = authoring(
        { findById: async () => webhookTrigger(), update },
        AutomationProviderRegistryService.create(cipher),
      );

      await service.update({
        id: "trigger-1",
        projectId: "project-1",
        actionParams: { url: "https://acme.test/hook", headers: { Authorization: "Bearer real" } },
      });

      const written = JSON.stringify(update.mock.calls[0]?.[0].actionParams);
      expect(written).toContain("headersEncrypted");
      expect(written).not.toContain('Bearer real"');
    });
  });
});

function queueTrigger(): Trigger {
  return {
    ...resumedTrigger(),
    action: "ADD_TO_ANNOTATION_QUEUE",
    actionParams: {
      annotators: [{ id: "user_owner", name: "Owner" }],
      createdByUserId: "user_owner",
    },
  };
}

function webhookTrigger(): Trigger {
  return {
    ...resumedTrigger(),
    action: "SEND_WEBHOOK",
    actionParams: { url: "https://acme.test/hook" },
  };
}
