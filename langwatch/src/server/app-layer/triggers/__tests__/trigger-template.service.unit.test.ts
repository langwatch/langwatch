import { TriggerAction } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  TEST_FIRE_EMAIL_SUBJECT_PREFIX,
  TEST_FIRE_NOTICE,
} from "~/server/event-sourcing/outbox/templating/banner";
import type {
  TriggerForTemplating,
  TriggerRepository,
} from "../repositories/trigger.repository";
import {
  TemplateValidationError,
  TestFireUnavailableError,
  type TriggerNotifier,
  TriggerNotFoundError,
  TriggerTemplateService,
} from "../trigger-template.service";

const BASE_HOST = "https://app.langwatch.ai";

function makeRow(
  overrides: Partial<TriggerForTemplating> = {},
): TriggerForTemplating {
  return {
    id: "tr_1",
    name: "High latency",
    message: null,
    alertType: null,
    action: TriggerAction.SEND_EMAIL,
    emailRecipients: ["alerts@acme.test"],
    slackWebhook: null,
    slackTemplateType: null,
    slackTemplate: null,
    emailSubjectTemplate: null,
    emailBodyTemplate: null,
    projectName: "Acme",
    projectSlug: "acme",
    ...overrides,
  };
}

function makeRepo(row: TriggerForTemplating | null) {
  const updateTemplates = vi.fn(async () => {});
  const repo: TriggerRepository = {
    findActiveForProject: vi.fn(async () => []),
    claimSend: vi.fn(async () => true),
    updateLastRunAt: vi.fn(async () => {}),
    findForTemplating: vi.fn(async () => row),
    updateTemplates,
  };
  return { repo, updateTemplates };
}

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

describe("TriggerTemplateService", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("saveTemplates", () => {
    describe("when a template column has invalid Liquid syntax", () => {
      it("rejects the save and persists nothing", async () => {
        const { repo, updateTemplates } = makeRepo(makeRow());
        const { notifier } = makeNotifier();
        const service = new TriggerTemplateService({
          repo,
          baseHost: BASE_HOST,
          notifier,
        });

        await expect(
          service.saveTemplates({
            triggerId: "tr_1",
            projectId: "proj_1",
            patch: { emailBodyTemplate: "{{ trigger.name" },
          }),
        ).rejects.toBeInstanceOf(TemplateValidationError);

        expect(updateTemplates).not.toHaveBeenCalled();
      });
    });

    describe("when the Slack template type is not recognised", () => {
      it("rejects the save", async () => {
        const { repo, updateTemplates } = makeRepo(makeRow());
        const { notifier } = makeNotifier();
        const service = new TriggerTemplateService({
          repo,
          baseHost: BASE_HOST,
          notifier,
        });

        await expect(
          service.saveTemplates({
            triggerId: "tr_1",
            projectId: "proj_1",
            patch: { slackTemplateType: "carousel" },
          }),
        ).rejects.toBeInstanceOf(TemplateValidationError);

        expect(updateTemplates).not.toHaveBeenCalled();
      });
    });

    describe("when all provided templates are valid", () => {
      it("persists the patch", async () => {
        const { repo, updateTemplates } = makeRepo(makeRow());
        const { notifier } = makeNotifier();
        const service = new TriggerTemplateService({
          repo,
          baseHost: BASE_HOST,
          notifier,
        });

        const patch = {
          emailSubjectTemplate: "({{ trigger.alertType }}) {{ project.name }}",
          emailBodyTemplate: "# {{ trigger.name }}",
        };
        await service.saveTemplates({
          triggerId: "tr_1",
          projectId: "proj_1",
          patch,
        });

        expect(updateTemplates).toHaveBeenCalledWith({
          triggerId: "tr_1",
          projectId: "proj_1",
          patch,
        });
      });
    });

    describe("when the trigger does not exist", () => {
      it("throws a not-found error", async () => {
        const { repo } = makeRepo(null);
        const { notifier } = makeNotifier();
        const service = new TriggerTemplateService({
          repo,
          baseHost: BASE_HOST,
          notifier,
        });

        await expect(
          service.saveTemplates({
            triggerId: "missing",
            projectId: "proj_1",
            patch: { emailBodyTemplate: "# ok" },
          }),
        ).rejects.toBeInstanceOf(TriggerNotFoundError);
      });
    });
  });

  describe("renderPreview", () => {
    describe("when an email body references a variable the context omits", () => {
      it("renders it empty and reports the missing variable", async () => {
        const { repo } = makeRepo(makeRow());
        const { notifier } = makeNotifier();
        const service = new TriggerTemplateService({
          repo,
          baseHost: BASE_HOST,
          notifier,
        });

        const preview = await service.renderPreview({
          triggerId: "tr_1",
          projectId: "proj_1",
          channel: "email",
          draft: { emailBodyTemplate: "Owner: {{ owner.name }}" },
        });

        if (preview.channel !== "email") throw new Error("expected email");
        expect(preview.missingVariables).toContain("owner");
        expect(preview.html).not.toContain("owner.name");
      });
    });

    describe("when a Block Kit template includes an interactive block", () => {
      it("keeps the allowed blocks and drops the interactive one", async () => {
        const { repo } = makeRepo(
          makeRow({ action: TriggerAction.SEND_SLACK_MESSAGE }),
        );
        const { notifier } = makeNotifier();
        const service = new TriggerTemplateService({
          repo,
          baseHost: BASE_HOST,
          notifier,
        });

        const template = JSON.stringify([
          {
            type: "header",
            text: { type: "plain_text", text: "{{ trigger.name }}" },
          },
          { type: "divider" },
          { type: "actions", elements: [{ type: "button", text: "x" }] },
        ]);

        const preview = await service.renderPreview({
          triggerId: "tr_1",
          projectId: "proj_1",
          channel: "slack",
          draft: { slackTemplate: template, slackTemplateType: "block_kit" },
        });

        if (preview.channel !== "slack") throw new Error("expected slack");
        if (!("blocks" in preview.payload)) {
          throw new Error("expected a blocks payload");
        }
        const types = preview.payload.blocks.map((b) => b.type);
        expect(types).toEqual(["header", "divider"]);
      });
    });

    describe("when a Block Kit template renders invalid JSON", () => {
      it("falls back to the default and reports the failure", async () => {
        const { repo } = makeRepo(
          makeRow({ action: TriggerAction.SEND_SLACK_MESSAGE }),
        );
        const { notifier } = makeNotifier();
        const service = new TriggerTemplateService({
          repo,
          baseHost: BASE_HOST,
          notifier,
        });

        const preview = await service.renderPreview({
          triggerId: "tr_1",
          projectId: "proj_1",
          channel: "slack",
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
    describe("when the trigger emails recipients", () => {
      it("sends a banner-marked email to the configured recipients", async () => {
        const { repo } = makeRepo(
          makeRow({ emailRecipients: ["a@acme.test", "b@acme.test"] }),
        );
        const { notifier, sentEmails } = makeNotifier();
        const service = new TriggerTemplateService({
          repo,
          baseHost: BASE_HOST,
          notifier,
        });

        const result = await service.testFire({
          triggerId: "tr_1",
          projectId: "proj_1",
        });

        expect(result.channel).toBe("email");
        expect(result.recipientCount).toBe(2);
        expect(sentEmails).toHaveLength(1);
        expect(sentEmails[0]!.to).toEqual(["a@acme.test", "b@acme.test"]);
        expect(sentEmails[0]!.subject).toContain(TEST_FIRE_EMAIL_SUBJECT_PREFIX);
        expect(sentEmails[0]!.html).toContain(TEST_FIRE_NOTICE);
      });
    });

    describe("when the email trigger has no recipients", () => {
      it("refuses to test-fire", async () => {
        const { repo } = makeRepo(makeRow({ emailRecipients: [] }));
        const { notifier, sentEmails } = makeNotifier();
        const service = new TriggerTemplateService({
          repo,
          baseHost: BASE_HOST,
          notifier,
        });

        await expect(
          service.testFire({ triggerId: "tr_1", projectId: "proj_1" }),
        ).rejects.toBeInstanceOf(TestFireUnavailableError);
        expect(sentEmails).toHaveLength(0);
      });
    });

    describe("when the trigger posts to Slack", () => {
      it("posts a banner-marked message to the webhook", async () => {
        const { repo } = makeRepo(
          makeRow({
            action: TriggerAction.SEND_SLACK_MESSAGE,
            slackWebhook: "https://hooks.slack.com/services/T/B/X",
          }),
        );
        const { notifier, sentSlack } = makeNotifier();
        const service = new TriggerTemplateService({
          repo,
          baseHost: BASE_HOST,
          notifier,
        });

        const result = await service.testFire({
          triggerId: "tr_1",
          projectId: "proj_1",
        });

        expect(result.channel).toBe("slack");
        expect(sentSlack).toHaveLength(1);
        expect(sentSlack[0]!.webhook).toBe(
          "https://hooks.slack.com/services/T/B/X",
        );
        expect(JSON.stringify(sentSlack[0]!.payload)).toContain(
          TEST_FIRE_NOTICE,
        );
      });
    });

    describe("when the Slack trigger has no webhook", () => {
      it("refuses to test-fire", async () => {
        const { repo } = makeRepo(
          makeRow({ action: TriggerAction.SEND_SLACK_MESSAGE }),
        );
        const { notifier, sentSlack } = makeNotifier();
        const service = new TriggerTemplateService({
          repo,
          baseHost: BASE_HOST,
          notifier,
        });

        await expect(
          service.testFire({ triggerId: "tr_1", projectId: "proj_1" }),
        ).rejects.toBeInstanceOf(TestFireUnavailableError);
        expect(sentSlack).toHaveLength(0);
      });
    });
  });
});
