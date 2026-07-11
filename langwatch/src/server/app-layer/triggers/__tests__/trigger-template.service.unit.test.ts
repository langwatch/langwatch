import { AlertType } from "@prisma/client";
import { describe, expect, it } from "vitest";
import {
  TEST_FIRE_EMAIL_SUBJECT_PREFIX,
  TEST_FIRE_NOTICE,
} from "~/shared/templating/banner";
import { DEFAULT_ALERT_SLACK_BLOCK_KIT_TEMPLATE } from "~/shared/templating/defaults";
import graphAlertDetailedSource from "~/automations/providers/definitions/slack/templates/graph_alert_detailed.liquid?raw";
import { TemplateValidationError, TestFireUnavailableError } from "../errors";
import {
  type DraftIdentity,
  type DraftProject,
  type TestFireTriggerInput,
  type TriggerNotifier,
  testFireTrigger,
  validateTemplateDraft,
} from "../trigger-template.service";

const BASE_HOST = "https://app.langwatch.ai";

const PROJECT: DraftProject = { name: "Acme", slug: "acme" };
const TRIGGER: DraftIdentity = {
  name: "High latency",
  alertType: AlertType.WARNING,
};

function makeNotifier() {
  const sentEmails: Array<{
    to: string;
    bcc: string[];
    subject: string;
    html: string;
  }> = [];
  const sentSlack: Array<{ webhook: string; payload: unknown }> = [];
  const sentSlackBot: Array<{
    token: string;
    channel: string;
    payload: unknown;
  }> = [];
  const notifier: TriggerNotifier = {
    sendEmail: async (args) => {
      sentEmails.push(args);
    },
    sendSlack: async (args) => {
      sentSlack.push(args);
    },
    sendSlackBot: async (args) => {
      sentSlackBot.push(args);
    },
  };
  return { notifier, sentEmails, sentSlack, sentSlackBot };
}

function makeService(notifier: TriggerNotifier) {
  const deps = { baseHost: BASE_HOST, notifier };
  return {
    testFire: (input: TestFireTriggerInput) => testFireTrigger(deps, input),
  };
}

describe("validateTemplateDraft", () => {
  describe("when a Liquid template has invalid syntax", () => {
    it("throws a validation error targeting the offending field", () => {
      expect(() =>
        validateTemplateDraft({ emailBodyTemplate: "{{ trigger.name" }),
      ).toThrowError(TemplateValidationError);
      expect(() =>
        validateTemplateDraft({ emailBodyTemplate: "{{ trigger.name" }),
      ).toThrowError(expect.objectContaining({ field: "emailBodyTemplate" }));
    });
  });

  describe("when the Slack template type is not recognised", () => {
    it("throws a validation error targeting slackTemplateType", () => {
      expect(() =>
        validateTemplateDraft({ slackTemplateType: "carousel" }),
      ).toThrowError(TemplateValidationError);
      expect(() =>
        validateTemplateDraft({ slackTemplateType: "carousel" }),
      ).toThrowError(expect.objectContaining({ field: "slackTemplateType" }));
    });
  });

  describe("when slackTemplate is set without a slackTemplateType", () => {
    it("throws a validation error targeting slackTemplateType", () => {
      expect(() =>
        validateTemplateDraft({ slackTemplate: "Hi {{ project.name }}" }),
      ).toThrowError(TemplateValidationError);
      expect(() =>
        validateTemplateDraft({ slackTemplate: "Hi {{ project.name }}" }),
      ).toThrowError(expect.objectContaining({ field: "slackTemplateType" }));
    });
  });

  describe("when every provided template is valid", () => {
    it("passes silently", () => {
      expect(() =>
        validateTemplateDraft({
          emailSubjectTemplate: "({{ trigger.alertType }}) {{ project.name }}",
          emailBodyTemplate: "# {{ trigger.name }}",
          slackTemplateType: "string",
          slackTemplate: "Hi {{ project.name }}",
        }),
      ).not.toThrow();
    });
  });
});

describe("testFireTrigger", () => {
  describe("given a Slack bot destination", () => {
    it("posts via the Web API with gated blocks kept, not the webhook", async () => {
      const { notifier, sentSlack, sentSlackBot } = makeNotifier();
      const service = makeService(notifier);

      // A data_table hero (gated) + a section fallback. Over a webhook the
      // table would be dropped; the bot path keeps it (gate open).
      const gatedTemplate = JSON.stringify([
        {
          type: "data_table",
          caption: "matches",
          rows: [
            [{ type: "raw_text", text: "Trace" }],
            [{ type: "raw_text", text: "t-1" }],
          ],
        },
        { type: "section", text: { type: "mrkdwn", text: "fallback" } },
      ]);

      const result = await service.testFire({
        channel: "slack",
        trigger: TRIGGER,
        project: PROJECT,
        draft: { slackTemplateType: "block_kit", slackTemplate: gatedTemplate },
        recipients: [],
        webhook: null,
        botDestination: { token: "xoxb-live", channel: "C1" },
      });

      expect(result.errors).toEqual([]);
      // Delivered via the Web API, not the incoming webhook.
      expect(sentSlack).toHaveLength(0);
      expect(sentSlackBot).toHaveLength(1);
      expect(sentSlackBot[0]).toMatchObject({
        token: "xoxb-live",
        channel: "C1",
      });
      // The gated block survived — proof the gate was opened for bot delivery.
      expect(JSON.stringify(sentSlackBot[0]?.payload)).toContain("data_table");
    });
  });

  describe("given a graph-alert draft rendering a gallery Block Kit template", () => {
    it("renders the alert example context — metric, condition, dashboard URL all populated", async () => {
      const { notifier, sentSlack } = makeNotifier();
      const service = makeService(notifier);

      const result = await service.testFire({
        channel: "slack",
        trigger: TRIGGER,
        project: PROJECT,
        draft: {
          slackTemplateType: "block_kit",
          slackTemplate: DEFAULT_ALERT_SLACK_BLOCK_KIT_TEMPLATE,
        },
        recipients: [],
        webhook: "https://hooks.slack.com/services/abc",
        graphAlert: {
          graphName: "Traces count",
          metricLabel: "Traces count",
          operator: "gt",
          threshold: 10,
          timePeriodMinutes: 30,
        },
      });

      expect(result.missingVariables).toEqual([]);
      expect(result.errors).toEqual([]);
      const payload = JSON.stringify(sentSlack[0]?.payload);
      expect(payload).toContain("Traces count");
      expect(payload).toContain("is greater than");
      expect(payload).toContain("last 30 minutes");
      expect(payload).toContain("/acme/analytics/custom/example-graph");
    });

    // Regression for the field-5015 garbled test-fire: the exact gallery
    // template the user selected ("Alert — detailed") must render populated
    // fields + a real dashboard URL. The empty-field symptom happens when
    // the alert template is rendered against the TRACE context — a null
    // `graphAlert` — so we assert the dashboard link resolves and the
    // skeleton labels never appear alone.
    it("renders the real 'graph_alert_detailed' gallery source with a resolved dashboard URL", async () => {
      const { notifier, sentSlack } = makeNotifier();
      const service = makeService(notifier);

      const result = await service.testFire({
        channel: "slack",
        trigger: TRIGGER,
        project: PROJECT,
        draft: {
          slackTemplateType: "block_kit",
          slackTemplate: graphAlertDetailedSource,
        },
        recipients: [],
        webhook: "https://hooks.slack.com/services/abc",
        graphAlert: {
          graphName: "Traces count",
          metricLabel: "Traces count",
          operator: "gt",
          threshold: 10,
          timePeriodMinutes: 30,
        },
      });

      expect(result.errors).toEqual([]);
      const payload = JSON.stringify(sentSlack[0]?.payload);
      // A populated dashboard link — the empty `<|Open dashboard>` symptom
      // is precisely a missing graph.url from a trace context.
      expect(payload).toContain("/acme/analytics/custom/example-graph|");
      expect(payload).toContain("Traces count");
      expect(payload).toContain("is greater than");
      // The value line carries the example currentValue, not a blank.
      expect(payload).toContain("12");
    });
  });

  describe("given a graph-alert draft with null templates (framework defaults)", () => {
    it("falls back to the ALERT defaults, not the trace defaults", async () => {
      const { notifier, sentSlack } = makeNotifier();
      const service = makeService(notifier);

      const result = await service.testFire({
        channel: "slack",
        trigger: TRIGGER,
        project: PROJECT,
        draft: {},
        recipients: [],
        webhook: "https://hooks.slack.com/services/abc",
        graphAlert: { metricLabel: "Traces count" },
      });

      expect(result.usedDefault).toBe(true);
      const payload = JSON.stringify(sentSlack[0]?.payload);
      expect(payload).toContain("Traces count");
      expect(payload).not.toContain("matching trace");
    });
  });

  describe("testFire", () => {
    describe("when the channel is email and recipients are configured", () => {
      it("sends a banner-marked email to the recipients", async () => {
        const { notifier, sentEmails } = makeNotifier();
        const service = makeService(notifier);

        const result = await service.testFire({
          channel: "email",
          trigger: TRIGGER,
          project: PROJECT,
          draft: {},
          recipients: ["a@acme.test", "b@acme.test"],
          webhook: null,
        });

        expect(result.recipientCount).toBe(2);
        expect(sentEmails).toHaveLength(1);
        expect(sentEmails[0]!.to).toMatch(
          /^LangWatch Triggers <no-reply\+[a-f0-9]{12}@/,
        );
        expect(sentEmails[0]!.bcc).toEqual(["a@acme.test", "b@acme.test"]);
        expect(sentEmails[0]!.subject).toContain(
          TEST_FIRE_EMAIL_SUBJECT_PREFIX,
        );
        expect(sentEmails[0]!.html).toContain(TEST_FIRE_NOTICE);
      });
    });

    describe("when the channel is email but no recipients are configured", () => {
      it("refuses to test-fire", async () => {
        const { notifier, sentEmails } = makeNotifier();
        const service = makeService(notifier);

        await expect(
          service.testFire({
            channel: "email",
            trigger: TRIGGER,
            project: PROJECT,
            draft: {},
            recipients: [],
            webhook: null,
          }),
        ).rejects.toBeInstanceOf(TestFireUnavailableError);
        expect(sentEmails).toHaveLength(0);
      });
    });

    describe("when the channel is Slack and a webhook is configured", () => {
      it("posts a banner-marked message to the webhook", async () => {
        const { notifier, sentSlack } = makeNotifier();
        const service = makeService(notifier);

        const result = await service.testFire({
          channel: "slack",
          trigger: TRIGGER,
          project: PROJECT,
          draft: {},
          recipients: [],
          webhook: "https://hooks.slack.com/services/T/B/X",
        });

        expect(result.recipientCount).toBe(1);
        expect(sentSlack).toHaveLength(1);
        expect(sentSlack[0]!.webhook).toBe(
          "https://hooks.slack.com/services/T/B/X",
        );
        expect(JSON.stringify(sentSlack[0]!.payload)).toContain(
          TEST_FIRE_NOTICE,
        );
      });
    });

    describe("when the channel is Slack but no webhook is configured", () => {
      it("refuses to test-fire", async () => {
        const { notifier, sentSlack } = makeNotifier();
        const service = makeService(notifier);

        await expect(
          service.testFire({
            channel: "slack",
            trigger: TRIGGER,
            project: PROJECT,
            draft: {},
            recipients: [],
            webhook: null,
          }),
        ).rejects.toBeInstanceOf(TestFireUnavailableError);
        expect(sentSlack).toHaveLength(0);
      });
    });

    describe("when the draft has slackTemplate but no slackTemplateType", () => {
      it("rejects with a validation error and sends nothing", async () => {
        const { notifier, sentSlack } = makeNotifier();
        const service = makeService(notifier);

        await expect(
          service.testFire({
            channel: "slack",
            trigger: TRIGGER,
            project: PROJECT,
            draft: { slackTemplate: "Hi {{ project.name }}" },
            recipients: [],
            webhook: "https://hooks.slack.com/services/T/B/X",
          }),
        ).rejects.toBeInstanceOf(TemplateValidationError);
        expect(sentSlack).toHaveLength(0);
      });
    });

    describe("when the draft carries a custom Slack template", () => {
      it("renders the custom template instead of the framework default", async () => {
        const { notifier, sentSlack } = makeNotifier();
        const service = makeService(notifier);

        const result = await service.testFire({
          channel: "slack",
          trigger: TRIGGER,
          project: PROJECT,
          draft: {
            slackTemplateType: "string",
            slackTemplate: "Custom alert for {{ project.name }}",
          },
          recipients: [],
          webhook: "https://hooks.slack.com/services/T/B/X",
        });

        expect(result.usedDefault).toBe(false);
        expect(sentSlack).toHaveLength(1);
        expect(JSON.stringify(sentSlack[0]!.payload)).toContain(
          "Custom alert for Acme",
        );
      });
    });
  });
});
