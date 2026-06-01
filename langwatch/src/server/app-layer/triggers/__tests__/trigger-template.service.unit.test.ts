import { AlertType } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  TEST_FIRE_EMAIL_SUBJECT_PREFIX,
  TEST_FIRE_NOTICE,
} from "~/shared/templating/banner";
import {
  type DraftIdentity,
  type DraftProject,
  TemplateValidationError,
  TestFireUnavailableError,
  type TriggerNotifier,
  TriggerTemplateService,
  validateTemplateDraft,
} from "../trigger-template.service";

const BASE_HOST = "https://app.langwatch.ai";

const PROJECT: DraftProject = { name: "Acme", slug: "acme" };
const TRIGGER: DraftIdentity = {
  name: "High latency",
  alertType: AlertType.WARNING,
};

function makeNotifier() {
  const sentEmails: Array<{ to: string[]; subject: string; html: string }> = [];
  const sentSlack: Array<{ webhook: string; payload: unknown }> = [];
  const notifier: TriggerNotifier = {
    sendEmail: async (args) => {
      sentEmails.push(args);
    },
    sendSlack: async (args) => {
      sentSlack.push(args);
    },
  };
  return { notifier, sentEmails, sentSlack };
}

function makeService(notifier: TriggerNotifier) {
  return new TriggerTemplateService({ baseHost: BASE_HOST, notifier });
}

describe("validateTemplateDraft", () => {
  describe("when a Liquid template has invalid syntax", () => {
    it("throws a validation error", () => {
      expect(() =>
        validateTemplateDraft({ emailBodyTemplate: "{{ trigger.name" }),
      ).toThrowError(TemplateValidationError);
    });
  });

  describe("when the Slack template type is not recognised", () => {
    it("throws a validation error", () => {
      expect(() =>
        validateTemplateDraft({ slackTemplateType: "carousel" }),
      ).toThrowError(TemplateValidationError);
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

describe("TriggerTemplateService", () => {
  beforeEach(() => {
    vi.clearAllMocks();
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
        expect(sentEmails[0]!.to).toEqual(["a@acme.test", "b@acme.test"]);
        expect(sentEmails[0]!.subject).toContain(TEST_FIRE_EMAIL_SUBJECT_PREFIX);
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
  });
});
