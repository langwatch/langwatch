import { AlertType, TriggerAction } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  TEST_FIRE_EMAIL_SUBJECT_PREFIX,
  TEST_FIRE_NOTICE,
} from "~/server/event-sourcing/outbox/templating/banner";
import {
  InvalidEmailRecipientError,
  MissingAnnotatorError,
  MissingSlackWebhookError,
} from "../errors";
import {
  type DraftIdentity,
  type DraftProject,
  TemplateValidationError,
  TestFireUnavailableError,
  type TriggerNotifier,
  TriggerTemplateService,
  validateRecipientFormats,
  validateTemplateDraft,
  validateUpsertActionParams,
} from "../trigger-template.service";

const BASE_HOST = "https://app.langwatch.ai";

const PROJECT: DraftProject = { name: "Acme", slug: "acme" };
const TRIGGER: DraftIdentity = {
  name: "High latency",
  alertType: AlertType.WARNING,
  message: "p95 over budget",
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

describe("validateRecipientFormats", () => {
  describe("when an address fails RFC shape", () => {
    it("throws an invalid-recipient error carrying the offending address", () => {
      expect(() =>
        validateRecipientFormats(["ok@acme.test", "no-at-sign"]),
      ).toThrowError(InvalidEmailRecipientError);
    });
  });

  describe("when every address passes RFC shape", () => {
    it("passes silently", () => {
      expect(() =>
        validateRecipientFormats(["a@acme.test", "b@acme.test"]),
      ).not.toThrow();
    });
  });
});

describe("validateUpsertActionParams", () => {
  describe("when SEND_EMAIL has an invalid recipient", () => {
    it("throws an invalid-recipient error", () => {
      expect(() =>
        validateUpsertActionParams({
          action: TriggerAction.SEND_EMAIL,
          actionParams: { members: ["broken"] },
        }),
      ).toThrowError(InvalidEmailRecipientError);
    });
  });

  describe("when SEND_SLACK_MESSAGE has no webhook", () => {
    it("throws a missing-webhook error", () => {
      expect(() =>
        validateUpsertActionParams({
          action: TriggerAction.SEND_SLACK_MESSAGE,
          actionParams: {},
        }),
      ).toThrowError(MissingSlackWebhookError);
    });
  });

  describe("when ADD_TO_ANNOTATION_QUEUE has no annotators", () => {
    it("throws a missing-annotator error", () => {
      expect(() =>
        validateUpsertActionParams({
          action: TriggerAction.ADD_TO_ANNOTATION_QUEUE,
          actionParams: { annotators: [] },
        }),
      ).toThrowError(MissingAnnotatorError);
    });
  });

  describe("when the action's required params are present", () => {
    it("passes silently", () => {
      expect(() =>
        validateUpsertActionParams({
          action: TriggerAction.SEND_SLACK_MESSAGE,
          actionParams: { slackWebhook: "https://hooks.slack.com/T/B/X" },
        }),
      ).not.toThrow();
    });
  });
});

describe("TriggerTemplateService", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("getScaffold", () => {
    it("returns the defaults, the variable contract, and an example context", () => {
      const { notifier } = makeNotifier();
      const service = makeService(notifier);

      const scaffold = service.getScaffold({ project: PROJECT });

      expect(scaffold.defaults.emailSubject).toMatch(/Trigger/);
      expect(scaffold.variables.map((v) => v.path)).toContain("trigger.name");
      expect(scaffold.variables.map((v) => v.path)).toContain("match.trace.url");
      expect(scaffold.example.project.slug).toBe("acme");
      expect(scaffold.example.match).not.toBeNull();
    });
  });

  describe("renderPreview", () => {
    describe("when an email body references a variable the context omits", () => {
      it("renders it empty and reports the missing variable", async () => {
        const { notifier } = makeNotifier();
        const service = makeService(notifier);

        const preview = await service.renderPreview({
          channel: "email",
          trigger: TRIGGER,
          project: PROJECT,
          draft: { emailBodyTemplate: "Owner: {{ owner.name }}" },
        });

        if (preview.channel !== "email") throw new Error("expected email");
        expect(preview.missingVariables).toContain("owner");
        expect(preview.html).not.toContain("owner.name");
      });
    });

    describe("when a Block Kit template includes an interactive block", () => {
      it("keeps allowed blocks and drops the interactive one", async () => {
        const { notifier } = makeNotifier();
        const service = makeService(notifier);

        const template = JSON.stringify([
          {
            type: "header",
            text: { type: "plain_text", text: "{{ trigger.name }}" },
          },
          { type: "divider" },
          { type: "actions", elements: [{ type: "button", text: "x" }] },
        ]);

        const preview = await service.renderPreview({
          channel: "slack",
          trigger: TRIGGER,
          project: PROJECT,
          draft: { slackTemplate: template, slackTemplateType: "block_kit" },
        });

        if (preview.channel !== "slack") throw new Error("expected slack");
        if (!("blocks" in preview.payload)) {
          throw new Error("expected a blocks payload");
        }
        expect(preview.payload.blocks.map((b) => b.type)).toEqual([
          "header",
          "divider",
        ]);
      });
    });

    describe("when a Block Kit template renders invalid JSON", () => {
      it("falls back to the default and reports the failure", async () => {
        const { notifier } = makeNotifier();
        const service = makeService(notifier);

        const preview = await service.renderPreview({
          channel: "slack",
          trigger: TRIGGER,
          project: PROJECT,
          draft: {
            slackTemplate: "not json at all",
            slackTemplateType: "block_kit",
          },
        });

        if (preview.channel !== "slack") throw new Error("expected slack");
        expect(preview.usedDefault).toBe(true);
        expect("text" in preview.payload).toBe(true);
        expect(preview.errors.length).toBeGreaterThan(0);
      });
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

    describe("when the channel is email and a recipient is malformed", () => {
      it("rejects before dispatching to the notifier", async () => {
        const { notifier, sentEmails } = makeNotifier();
        const service = makeService(notifier);

        await expect(
          service.testFire({
            channel: "email",
            trigger: TRIGGER,
            project: PROJECT,
            draft: {},
            recipients: ["a@acme.test", "not-an-email"],
            webhook: null,
          }),
        ).rejects.toBeInstanceOf(InvalidEmailRecipientError);
        expect(sentEmails).toHaveLength(0);
      });
    });
  });
});
