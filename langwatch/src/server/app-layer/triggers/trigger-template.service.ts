import { TriggerAction } from "@prisma/client";
import {
  DEFAULT_EMAIL_BODY_TEMPLATE,
  DEFAULT_EMAIL_SUBJECT_TEMPLATE,
  DEFAULT_SLACK_TEMPLATE,
} from "~/server/event-sourcing/outbox/templating/defaults";
import { renderTriggerEmail } from "~/server/event-sourcing/outbox/templating/renderEmail";
import {
  type SlackPayload,
  type SlackTemplateType,
  renderTriggerSlack,
} from "~/server/event-sourcing/outbox/templating/renderSlack";
import {
  EXAMPLE_MATCHES,
  TEMPLATE_VARIABLE_PATHS,
} from "~/server/event-sourcing/outbox/templating/exampleContext";
import {
  buildTemplateContext,
  type TemplateContext,
} from "~/server/event-sourcing/outbox/templating/templateContext";
import { validateLiquid } from "~/server/event-sourcing/outbox/templating/validate";
import type {
  TriggerForTemplating,
  TriggerRepository,
  TriggerTemplateColumns,
  TriggerTemplatePatch,
} from "./repositories/trigger.repository";

export type TemplateChannel = "email" | "slack";

export const SLACK_TEMPLATE_TYPES = ["string", "block_kit"] as const;

/** Sends a test-fire notification. Injected so the service is testable without
 *  hitting SES/SendGrid or a real Slack webhook. */
export interface TriggerNotifier {
  sendEmail(args: {
    to: string[];
    subject: string;
    html: string;
  }): Promise<void>;
  sendSlack(args: { webhook: string; payload: SlackPayload }): Promise<void>;
}

/** Raw Liquid sources for the framework defaults, shown as editor placeholders. */
export interface TemplateDefaults {
  emailSubject: string;
  emailBody: string;
  slack: string;
}

export interface TriggerTemplatesView {
  action: TriggerAction;
  current: TriggerTemplateColumns;
  defaults: TemplateDefaults;
  /** Dotted variable paths a template can reference (editor autocomplete). */
  variables: string[];
  /** The example data the preview renders against, for the author to inspect. */
  example: TemplateContext;
}

export interface EmailPreview {
  channel: "email";
  subject: string;
  html: string;
  usedDefault: boolean;
  missingVariables: string[];
  errors: string[];
}

export interface SlackPreview {
  channel: "slack";
  payload: SlackPayload;
  usedDefault: boolean;
  missingVariables: string[];
  errors: string[];
}

export type TemplatePreview = EmailPreview | SlackPreview;

export interface TestFireResult {
  channel: TemplateChannel;
  recipientCount: number;
  usedDefault: boolean;
  missingVariables: string[];
  errors: string[];
}

export class TriggerNotFoundError extends Error {
  name = "TriggerNotFoundError" as const;
  constructor(triggerId: string) {
    super(`Trigger ${triggerId} not found`);
  }
}

/** A template column failed `validateLiquid` (or an invalid Slack type) on save. */
export class TemplateValidationError extends Error {
  name = "TemplateValidationError" as const;
  constructor(
    readonly field: keyof TriggerTemplateColumns,
    message: string,
  ) {
    super(message);
  }
}

/** Test fire has nothing to deliver to (no email recipient / Slack webhook). */
export class TestFireUnavailableError extends Error {
  name = "TestFireUnavailableError" as const;
  constructor(message: string) {
    super(message);
  }
}

const LIQUID_TEMPLATE_COLUMNS = [
  "slackTemplate",
  "emailSubjectTemplate",
  "emailBodyTemplate",
] as const satisfies readonly (keyof TriggerTemplateColumns)[];

function normalizeSlackType(raw: string | null): SlackTemplateType | null {
  if (raw === "block_kit") return "block_kit";
  if (raw === "string") return "string";
  return null;
}

/**
 * Drives the trigger template-authoring surface: reading and saving the
 * customer's Liquid templates (validated before persisting), rendering a live
 * preview from in-progress draft sources, and dispatching a banner-marked test
 * fire to the trigger's configured recipients. The rendering itself lives in
 * the `outbox/templating` module; this service supplies the trigger/project
 * context and the persistence + delivery around it.
 */
export class TriggerTemplateService {
  private readonly repo: TriggerRepository;
  private readonly baseHost: string;
  private readonly notifier: TriggerNotifier;

  constructor(deps: {
    repo: TriggerRepository;
    baseHost: string;
    notifier: TriggerNotifier;
  }) {
    this.repo = deps.repo;
    this.baseHost = deps.baseHost;
    this.notifier = deps.notifier;
  }

  async getTemplates(
    triggerId: string,
    projectId: string,
  ): Promise<TriggerTemplatesView> {
    const trigger = await this.repo.findForTemplating(triggerId, projectId);
    if (!trigger) throw new TriggerNotFoundError(triggerId);

    return {
      action: trigger.action,
      current: {
        slackTemplateType: trigger.slackTemplateType,
        slackTemplate: trigger.slackTemplate,
        emailSubjectTemplate: trigger.emailSubjectTemplate,
        emailBodyTemplate: trigger.emailBodyTemplate,
      },
      defaults: {
        emailSubject: DEFAULT_EMAIL_SUBJECT_TEMPLATE,
        emailBody: DEFAULT_EMAIL_BODY_TEMPLATE,
        slack: DEFAULT_SLACK_TEMPLATE,
      },
      variables: TEMPLATE_VARIABLE_PATHS,
      example: this.sampleContext(trigger),
    };
  }

  async saveTemplates({
    triggerId,
    projectId,
    patch,
  }: {
    triggerId: string;
    projectId: string;
    patch: TriggerTemplatePatch;
  }): Promise<void> {
    if (
      patch.slackTemplateType != null &&
      !(SLACK_TEMPLATE_TYPES as readonly string[]).includes(
        patch.slackTemplateType,
      )
    ) {
      throw new TemplateValidationError(
        "slackTemplateType",
        `Invalid Slack template type "${patch.slackTemplateType}"`,
      );
    }

    for (const column of LIQUID_TEMPLATE_COLUMNS) {
      const source = patch[column];
      if (typeof source === "string" && source.trim() !== "") {
        const result = validateLiquid(source);
        if (!result.valid) {
          throw new TemplateValidationError(
            column,
            result.error ?? "Invalid Liquid syntax",
          );
        }
      }
    }

    const trigger = await this.repo.findForTemplating(triggerId, projectId);
    if (!trigger) throw new TriggerNotFoundError(triggerId);

    await this.repo.updateTemplates({ triggerId, projectId, patch });
  }

  async renderPreview({
    triggerId,
    projectId,
    channel,
    draft,
  }: {
    triggerId: string;
    projectId: string;
    channel: TemplateChannel;
    draft: TriggerTemplatePatch;
  }): Promise<TemplatePreview> {
    const trigger = await this.repo.findForTemplating(triggerId, projectId);
    if (!trigger) throw new TriggerNotFoundError(triggerId);

    const context = this.sampleContext(trigger);

    if (channel === "email") {
      const rendered = await renderTriggerEmail({
        subjectTemplate: draft.emailSubjectTemplate ?? null,
        bodyTemplate: draft.emailBodyTemplate ?? null,
        context,
      });
      return {
        channel: "email",
        subject: rendered.subject,
        html: rendered.html,
        usedDefault: rendered.usedDefault,
        missingVariables: rendered.missingVariables,
        errors: rendered.errors,
      };
    }

    const rendered = await renderTriggerSlack({
      templateType: normalizeSlackType(draft.slackTemplateType ?? null),
      template: draft.slackTemplate ?? null,
      context,
    });
    return {
      channel: "slack",
      payload: rendered.payload,
      usedDefault: rendered.usedDefault,
      missingVariables: rendered.missingVariables,
      errors: rendered.errors,
    };
  }

  async testFire({
    triggerId,
    projectId,
  }: {
    triggerId: string;
    projectId: string;
  }): Promise<TestFireResult> {
    const trigger = await this.repo.findForTemplating(triggerId, projectId);
    if (!trigger) throw new TriggerNotFoundError(triggerId);

    const context = this.sampleContext(trigger);

    if (trigger.action === TriggerAction.SEND_EMAIL) {
      if (trigger.emailRecipients.length === 0) {
        throw new TestFireUnavailableError(
          "This trigger has no email recipients to test-fire to.",
        );
      }
      const rendered = await renderTriggerEmail({
        subjectTemplate: trigger.emailSubjectTemplate,
        bodyTemplate: trigger.emailBodyTemplate,
        context,
        testFire: true,
      });
      await this.notifier.sendEmail({
        to: trigger.emailRecipients,
        subject: rendered.subject,
        html: rendered.html,
      });
      return {
        channel: "email",
        recipientCount: trigger.emailRecipients.length,
        usedDefault: rendered.usedDefault,
        missingVariables: rendered.missingVariables,
        errors: rendered.errors,
      };
    }

    if (trigger.action === TriggerAction.SEND_SLACK_MESSAGE) {
      if (!trigger.slackWebhook) {
        throw new TestFireUnavailableError(
          "This trigger has no Slack webhook to test-fire to.",
        );
      }
      const rendered = await renderTriggerSlack({
        templateType: normalizeSlackType(trigger.slackTemplateType),
        template: trigger.slackTemplate,
        context,
        testFire: true,
      });
      await this.notifier.sendSlack({
        webhook: trigger.slackWebhook,
        payload: rendered.payload,
      });
      return {
        channel: "slack",
        recipientCount: 1,
        usedDefault: rendered.usedDefault,
        missingVariables: rendered.missingVariables,
        errors: rendered.errors,
      };
    }

    throw new TestFireUnavailableError(
      "Only email and Slack triggers can be test-fired.",
    );
  }

  private sampleContext(trigger: TriggerForTemplating): TemplateContext {
    return buildTemplateContext({
      trigger: {
        id: trigger.id,
        name: trigger.name,
        message: trigger.message ?? "",
        alertType: trigger.alertType,
      },
      project: { name: trigger.projectName, slug: trigger.projectSlug },
      baseHost: this.baseHost,
      matches: EXAMPLE_MATCHES,
    });
  }
}
