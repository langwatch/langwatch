import type { Project, Trigger } from "@prisma/client";
import { TriggerAction } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";
import { buildGraphAlertTemplateContext } from "~/shared/templating/templateContext";
import { dispatchGraphAlertAction } from "../graphAlertActionDispatch";

const NOW = new Date("2026-06-21T10:00:00.000Z");

function makeTrigger(overrides: Partial<Trigger> = {}): Trigger {
  return {
    id: "trg_1",
    projectId: "proj_1",
    name: "High latency",
    action: TriggerAction.SEND_EMAIL,
    actionParams: {},
    filters: {},
    active: true,
    deleted: false,
    alertType: "WARNING",
    message: null,
    customGraphId: "graph_1",
    notificationCadence: "immediate",
    traceDebounceMs: 30_000,
    slackTemplateType: null,
    slackTemplate: null,
    emailSubjectTemplate: null,
    emailBodyTemplate: null,
    lastRunAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  } as unknown as Trigger;
}

function makeProject(): Project {
  return {
    id: "proj_1",
    name: "Acme",
    slug: "acme",
  } as unknown as Project;
}

function makeContext() {
  return buildGraphAlertTemplateContext({
    trigger: { id: "trg_1", name: "High latency", alertType: "WARNING" },
    graph: { id: "graph_1", name: "Latency p95" },
    metric: { label: "Latency p95", seriesName: "0/duration/p95" },
    condition: { operator: "gt", threshold: 500, timePeriodMinutes: 60 },
    currentValue: 712,
    occurredAt: NOW,
    reason: "real-time",
    project: { id: "proj_1", name: "Acme", slug: "acme" },
    baseHost: "https://app.langwatch.ai",
  });
}

function makeDeps() {
  const sendEmail = vi.fn(async () => undefined);
  const sendSlack = vi.fn(async () => undefined);
  return {
    deps: { sendEmail, sendSlack } as unknown as Parameters<
      typeof dispatchGraphAlertAction
    >[0]["deps"],
    sendEmail,
    sendSlack,
  };
}

describe("dispatchGraphAlertAction", () => {
  describe("given a SEND_EMAIL trigger with recipients", () => {
    it("renders against the alert defaults and calls sendEmail with subject + html", async () => {
      const { deps, sendEmail, sendSlack } = makeDeps();
      const result = await dispatchGraphAlertAction({
        deps,
        input: {
          trigger: makeTrigger(),
          project: makeProject(),
          context: makeContext(),
          recipients: ["a@example.com", "b@example.com"],
          slackWebhook: null,
        },
      });

      expect(result.channel).toBe("email");
      expect(result.didSend).toBe(true);
      expect(sendSlack).not.toHaveBeenCalled();
      expect(sendEmail).toHaveBeenCalledTimes(1);
      const call = sendEmail.mock.calls[0]?.[0] as {
        triggerEmails: string[];
        triggerId: string;
        projectId: string;
        subject: string;
        html: string;
      };
      expect(call.triggerEmails).toEqual(["a@example.com", "b@example.com"]);
      expect(call.triggerId).toBe("trg_1");
      expect(call.projectId).toBe("proj_1");
      expect(call.subject).toBe(
        "[Alert] High latency — Latency p95 is greater than 500",
      );
      expect(call.html).toContain("Latency p95");
      expect(call.html).toContain("712");
    });

    describe("when the trigger overrides emailSubjectTemplate", () => {
      it("renders the custom subject instead of the alert default", async () => {
        const { deps, sendEmail } = makeDeps();
        await dispatchGraphAlertAction({
          deps,
          input: {
            trigger: makeTrigger({
              emailSubjectTemplate:
                "Custom: {{ trigger.name }} crossed {{ condition.threshold }}",
            }),
            project: makeProject(),
            context: makeContext(),
            recipients: ["a@example.com"],
            slackWebhook: null,
          },
        });
        const call = sendEmail.mock.calls[0]?.[0] as { subject: string };
        expect(call.subject).toBe("Custom: High latency crossed 500");
      });
    });

    describe("when the trigger overrides emailBodyTemplate", () => {
      it("renders the custom body Markdown into HTML", async () => {
        const { deps, sendEmail } = makeDeps();
        await dispatchGraphAlertAction({
          deps,
          input: {
            trigger: makeTrigger({
              emailBodyTemplate:
                "## Heads up\n\nValue **{{ currentValue }}** vs threshold {{ condition.threshold }}",
            }),
            project: makeProject(),
            context: makeContext(),
            recipients: ["a@example.com"],
            slackWebhook: null,
          },
        });
        const call = sendEmail.mock.calls[0]?.[0] as { html: string };
        expect(call.html).toContain("<h2>Heads up</h2>");
        expect(call.html).toContain("712");
        expect(call.html).toContain("500");
      });
    });

    describe("when recipients is empty", () => {
      it("skips the send and reports didSend false", async () => {
        const { deps, sendEmail } = makeDeps();
        const result = await dispatchGraphAlertAction({
          deps,
          input: {
            trigger: makeTrigger(),
            project: makeProject(),
            context: makeContext(),
            recipients: [],
            slackWebhook: null,
          },
        });
        expect(result.didSend).toBe(false);
        expect(sendEmail).not.toHaveBeenCalled();
      });
    });
  });

  describe("given a SEND_SLACK_MESSAGE trigger with a webhook", () => {
    it("renders against the alert defaults and calls sendSlack with payload", async () => {
      const { deps, sendSlack, sendEmail } = makeDeps();
      const result = await dispatchGraphAlertAction({
        deps,
        input: {
          trigger: makeTrigger({
            action: TriggerAction.SEND_SLACK_MESSAGE,
          }),
          project: makeProject(),
          context: makeContext(),
          recipients: [],
          slackWebhook: "https://hooks.slack.com/services/T/B/abc",
        },
      });

      expect(result.channel).toBe("slack");
      expect(result.didSend).toBe(true);
      expect(sendEmail).not.toHaveBeenCalled();
      expect(sendSlack).toHaveBeenCalledTimes(1);
      const call = sendSlack.mock.calls[0]?.[0] as {
        triggerWebhook: string;
        triggerName: string;
        payload: { text?: string; blocks?: unknown };
      };
      expect(call.triggerWebhook).toBe("https://hooks.slack.com/services/T/B/abc");
      expect(call.triggerName).toBe("High latency");
      const text = (call.payload as { text: string }).text;
      expect(text).toContain("High latency");
      expect(text).toContain("712");
    });

    describe("when the trigger overrides slackTemplate as block_kit", () => {
      it("renders the custom Block Kit JSON", async () => {
        const { deps, sendSlack } = makeDeps();
        await dispatchGraphAlertAction({
          deps,
          input: {
            trigger: makeTrigger({
              action: TriggerAction.SEND_SLACK_MESSAGE,
              slackTemplateType: "block_kit",
              slackTemplate: `[
  {"type": "section", "text": {"type": "mrkdwn", "text": {{ trigger.name | prepend: "*Alert:* " | json }}}}
]`,
            }),
            project: makeProject(),
            context: makeContext(),
            recipients: [],
            slackWebhook: "https://hooks.slack.com/services/T/B/xyz",
          },
        });
        const call = sendSlack.mock.calls[0]?.[0] as {
          payload: { blocks: Array<Record<string, unknown>> };
        };
        expect(call.payload.blocks).toHaveLength(1);
        expect(JSON.stringify(call.payload.blocks)).toContain(
          "*Alert:* High latency",
        );
      });
    });

    describe("when slackWebhook is null", () => {
      it("skips the send and reports didSend false", async () => {
        const { deps, sendSlack } = makeDeps();
        const result = await dispatchGraphAlertAction({
          deps,
          input: {
            trigger: makeTrigger({
              action: TriggerAction.SEND_SLACK_MESSAGE,
            }),
            project: makeProject(),
            context: makeContext(),
            recipients: [],
            slackWebhook: null,
          },
        });
        expect(result.didSend).toBe(false);
        expect(sendSlack).not.toHaveBeenCalled();
      });
    });
  });

  describe("given a trigger with a non-notify action", () => {
    it("throws a non-retryable DispatchError so the row dead-letters (dispatch5015-002)", async () => {
      const { deps, sendEmail, sendSlack } = makeDeps();
      await expect(
        dispatchGraphAlertAction({
          deps,
          input: {
            trigger: makeTrigger({ action: TriggerAction.ADD_TO_DATASET }),
            project: makeProject(),
            context: makeContext(),
            recipients: [],
            slackWebhook: null,
          },
        }),
      ).rejects.toThrow(/not supported/);
      expect(sendEmail).not.toHaveBeenCalled();
      expect(sendSlack).not.toHaveBeenCalled();
    });
  });
});
