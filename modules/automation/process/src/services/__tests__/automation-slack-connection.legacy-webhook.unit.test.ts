/** @vitest-environment node */
import { InvalidActionParamsError } from "@langwatch/automation-contract";
import { describe, expect, it } from "vitest";

import { sealWith } from "../../__tests__/fixtures/trigger-secrets.fixture.ts";
import { AutomationSlackConnectionService } from "../../features/slack/services/automation-slack-connection.service.ts";

/** @see modules/slack/specs/slack-connections.feature */
const crypto = { encrypt: (value: string) => value, decrypt: (value: string) => value };

function service() {
  const created: string[] = [];
  const connections = AutomationSlackConnectionService.create({
    slack: {
      getUsableSlackConnection: async () => {
        throw new Error("not reached");
      },
      findOrCreateSlackConnectionForSecret: async ({ secret }) => {
        created.push(secret);
        return { id: "connection-1", wasCreated: true };
      },
      claimConnection: async () => undefined,
      releaseConnection: async () => undefined,
    },
    projects: { getOrganizationId: async () => "organization-1" },
    triggers: sealWith(crypto),
  });
  return { connections, created };
}

describe("AutomationSlackConnectionService.connectActionParams", () => {
  describe("given a legacy webhook URL outside hooks.slack.com", () => {
    /** @scenario "A legacy webhook URL that is not a Slack incoming webhook is refused before anything is stored" */
    it("refuses it naming slackWebhook and stores no connection", async () => {
      const { connections, created } = service();

      const refused = connections.connectActionParams({
        projectId: "project-1",
        actorId: "user-1",
        actionParams: { slackWebhook: "http://127.0.0.1:1/services/T/B/X" },
      });

      await expect(refused).rejects.toBeInstanceOf(InvalidActionParamsError);
      await expect(refused).rejects.toMatchObject({ field: "slackWebhook" });
      expect(created).toEqual([]);
    });
  });
});
