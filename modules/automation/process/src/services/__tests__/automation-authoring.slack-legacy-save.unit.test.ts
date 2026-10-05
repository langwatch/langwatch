import { TriggerAction } from "@langwatch/automation-contract";
import type { MonitorApi } from "@langwatch/monitor-contract";
import type { ProjectApi } from "@langwatch/project-contract";
import type { SlackConnectionKind } from "@langwatch/slack-contract";
/** @vitest-environment node */
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { describe, expect, it } from "vitest";

import { SilentLogger } from "../../__tests__/fixtures/graph-activity.fixture.ts";
import { sealWith } from "../../__tests__/fixtures/trigger-secrets.fixture.ts";
import { createTestSlackDestinations } from "../../__tests__/testing.ts";
import { triggerRow } from "../../transport/__tests__/automation-rest-redaction.fixture.ts";
import { AutomationAuthoringService } from "../automation-authoring.service.ts";
import { AutomationProviderRegistryService } from "../automation-provider-registry.service.ts";
import { AutomationRulesService } from "../automation-rules.service.ts";
import { AutomationSlackConnectionService } from "../automation-slack-connection.service.ts";
import type { AutomationService } from "../automation.service.ts";

/** @see specs/automations/slack-connections.feature */
const crypto = {
  encrypt: (value: string) => `enc(${value})`,
  decrypt: (value: string) => value.replace(/^enc\(|\)$/g, ""),
};
// Built at runtime so no fixture reads as a real credential.
const TOKEN = ["xoxb", "fake", "stored"].join("-");

const legacyRow = triggerRow({
  id: "trigger-legacy",
  projectId: "project-1",
  name: "Errors to Slack",
  action: TriggerAction.SEND_SLACK_MESSAGE,
  actionParams: {
    slackDelivery: "bot",
    slackChannelId: "C0123",
    slackBotToken: crypto.encrypt(TOKEN),
  },
  filters: { "traces.error": ["true"] },
});

function connectionView({ id, kind }: { id: string; kind: SlackConnectionKind }) {
  return {
    id,
    name: id,
    kind,
    scopeType: "PROJECT" as const,
    scopeId: "project-1",
    scopeName: "Project",
    secretHint: "tokn",
    slackTeamId: null,
    slackTeamName: null,
    dependentAutomations: 0,
    createdAt: new Date(0),
    updatedAt: new Date(0),
  };
}

function dashboard() {
  const connectionsCreated: { kind: SlackConnectionKind; secret: string }[] = [];
  const written: Record<string, unknown>[] = [];
  const automation = createApiFixture<AutomationService>({
    findById: async () => legacyRow,
    validateTemplateDraft: () => undefined,
    update: async (command) => {
      written.push(command.actionParams ?? {});
      return { ...legacyRow, actionParams: command.actionParams ?? {} };
    },
    removeReportSchedule: async () => undefined,
    invalidate: async () => undefined,
  });
  const service = AutomationAuthoringService.create({
    automation,
    rules: AutomationRulesService.create({
      automation,
      projects: createApiFixture<ProjectApi>({}),
    }),
    monitors: createApiFixture<MonitorApi>({ getAllByIds: async () => [] }),
    providers: AutomationProviderRegistryService.create(sealWith(crypto)),
    slackChannels: { list: async () => ({ channels: [], error: null, gaps: [] }) },
    slackDestinations: createTestSlackDestinations(),
    slackConnections: AutomationSlackConnectionService.create({
      slack: {
        getUsableSlackConnection: async ({ id }) =>
          connectionView({ id, kind: connectionsCreated[0]?.kind ?? "BOT" }),
        findOrCreateSlackConnectionForSecret: async ({ kind, secret }) => {
          connectionsCreated.push({ kind, secret });
          return { id: "connection-1", wasCreated: true };
        },
        claimConnection: async () => undefined,
        releaseConnection: async () => undefined,
      },
      projects: { getOrganizationId: async () => "organization-1" },
      triggers: sealWith(crypto),
    }),
    traceFilters: { assertCompiles: () => undefined },
    limits: { count: async () => ({ allowed: true, resetAt: 0 }) },
    filterValidation: { assertWritable: async () => undefined },
    logger: new SilentLogger(),
  });

  return { service, connectionsCreated, written };
}

describe("AutomationAuthoringService.save", () => {
  describe("given an automation not yet migrated that still stores its own bot token", () => {
    describe("when the user saves it from the dashboard without retyping the token", () => {
      /** @scenario "Saving an automation not yet migrated from the dashboard moves its token into a connection" */
      /** @scenario "Editing a bot automation without re-entering the token" */
      it("points it at a connection holding that token and writes no token back", async () => {
        const { service, connectionsCreated, written } = dashboard();

        await service.save({
          author: { id: "user-1" },
          input: {
            projectId: "project-1",
            triggerId: "trigger-legacy",
            name: "Errors to Slack",
            action: TriggerAction.SEND_SLACK_MESSAGE,
            filters: { "traces.error": ["true"] },
            actionParams: { slackDelivery: "bot", slackChannelId: "C0123" },
            templates: {},
          },
        });

        expect(connectionsCreated).toEqual([{ kind: "BOT", secret: TOKEN }]);
        expect(written).toEqual([
          { slackIntegrationId: "connection-1", slackDelivery: "bot", slackChannelId: "C0123" },
        ]);
        expect(JSON.stringify(written)).not.toContain(TOKEN);
      });
    });
  });
});
