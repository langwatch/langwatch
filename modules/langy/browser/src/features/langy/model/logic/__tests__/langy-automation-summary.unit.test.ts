/**
 * What an automation card says, decided from real-shaped API reads, and when a failed step is
 * a Slack automation that named no connection.
 * @see specs/langy/langy-automations.feature
 */
import { describe, expect, it } from "vitest";

import {
  automationCondition,
  automationDestinations,
  automationKind,
  describeCron,
  type LangyAutomationRecord,
  mergeAutomation,
  readAutomations,
} from "../langy-automation-summary.ts";
import {
  isSlackConnectionRefusal,
  refusedSlackChannel,
  slackConnectionChoiceMessage,
} from "../langy-slack-connection-prompt.ts";

const alert = {
  id: "trig_1",
  name: "Support error rate",
  action: "SEND_SLACK_MESSAGE",
  active: true,
  kind: "ALERT",
  customGraphId: "graph_1",
  graphAlert: {
    seriesName: "0/metadata.error_rate/avg",
    operator: "gt",
    threshold: 5,
    timePeriod: 5,
  },
  actionParams: {
    slackIntegrationId: "slack_1",
    slackDelivery: "bot",
    slackChannelId: "support-alerts",
  },
  filters: {},
};

function readOne(value: unknown): LangyAutomationRecord {
  const [record] = readAutomations(value);
  if (!record) throw new Error("expected an automation");
  return record;
}

describe("automation summary", () => {
  it("reads an alert's kind, condition and Slack destination", () => {
    const record = readOne(alert);
    expect(automationKind(record)).toBe("alert");
    expect(automationCondition(record)).toBe("avg error rate > 5 over 5 min");
    expect(
      automationDestinations({
        record,
        slackConnections: [{ id: "slack_1", name: "Support Slack" }],
      }),
    ).toEqual([{ channel: "slack", label: "Support Slack", detail: "#support-alerts" }]);
  });

  it("reads a trace automation's query and email recipients", () => {
    const record = readOne({
      id: "trig_2",
      name: "Thumbs down",
      action: "SEND_EMAIL",
      filterQuery: "annotation:thumbs_down",
      actionParams: { members: ["me@example.com"] },
    });
    expect(automationCondition(record)).toBe("Trace filter · annotation:thumbs_down");
    expect(automationDestinations({ record })[0]).toMatchObject({
      channel: "email",
      detail: "me@example.com",
    });
  });

  it("says a report's schedule the way the Automations composer does", () => {
    expect(describeCron({ cron: "0 9 * * 1", timezone: "Europe/Amsterdam" })).toBe(
      "Sends every Monday at 09:00 (Europe/Amsterdam)",
    );
    expect(describeCron({ cron: "*/5 * * * *", timezone: "" })).toBe("*/5 * * * * (UTC)");
  });

  /** @scenario "The automation card never shows a stored secret" */
  it("shows only a webhook's host, never its token or secret", () => {
    const record = readOne({
      id: "trig_3",
      name: "Hook",
      action: "SEND_WEBHOOK",
      actionParams: {
        url: "https://hooks.example.com/in/abc?token=s3cret",
        signingSecret: "[redacted]",
      },
    });
    const text = JSON.stringify(automationDestinations({ record }));
    expect(text).toContain("hooks.example.com");
    expect(text).not.toContain("s3cret");
    expect(text).not.toContain("redacted");
  });

  it("keeps a pause's state over the earlier read, and fills the rest", () => {
    const stated = readOne({ id: "trig_1", name: "Support error rate", active: false });
    const fresh = readOne({ ...alert, active: false });
    expect(mergeAutomation({ stated, fresh })).toMatchObject({
      active: false,
      action: "SEND_SLACK_MESSAGE",
    });
  });

  it("reads a list read into one record per automation", () => {
    expect(readAutomations([alert, { nope: true }, alert])).toHaveLength(2);
  });
});

describe("Slack connection refusal", () => {
  const command = (cmd: string) => ({ name: "bash", input: { command: cmd } });

  it("is a Slack create that named no connection", () => {
    const call = command(
      'langwatch trigger create "Errors" --action SEND_SLACK_MESSAGE --slack-channel "#support-alerts" --format json',
    );
    expect(isSlackConnectionRefusal(call)).toBe(true);
    expect(refusedSlackChannel(call)).toBe("#support-alerts");
  });

  it("is not a Slack create that named its connection, nor an email one", () => {
    expect(
      isSlackConnectionRefusal(
        command(
          "langwatch trigger create X --action SEND_SLACK_MESSAGE --slack-connection slack_1",
        ),
      ),
    ).toBe(false);
    expect(
      isSlackConnectionRefusal(command("langwatch trigger create X --action SEND_EMAIL")),
    ).toBe(false);
  });

  it("answers Langy with the connection's name and id, and no secret", () => {
    expect(
      slackConnectionChoiceMessage({
        connection: { id: "slack_1", name: "Support Slack" },
        channel: "#support-alerts",
      }),
    ).toBe('Use the Slack connection "Support Slack" (id slack_1) and post in #support-alerts.');
  });
});
