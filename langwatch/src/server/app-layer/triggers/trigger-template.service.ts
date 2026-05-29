import type { AlertType } from "@prisma/client";
import {
  DEFAULT_EMAIL_BODY_TEMPLATE,
  DEFAULT_EMAIL_SUBJECT_TEMPLATE,
  DEFAULT_SLACK_BLOCK_KIT_TEMPLATE,
  DEFAULT_SLACK_TEMPLATE,
} from "~/server/event-sourcing/outbox/templating/defaults";
import {
  EXAMPLE_MATCHES,
  TEMPLATE_VARIABLE_PATHS,
} from "~/server/event-sourcing/outbox/templating/exampleContext";
import { renderTriggerEmail } from "~/server/event-sourcing/outbox/templating/renderEmail";
import {
  type SlackPayload,
  type SlackTemplateType,
  renderTriggerSlack,
} from "~/server/event-sourcing/outbox/templating/renderSlack";
import {
  buildTemplateContext,
  type TemplateContext,
} from "~/server/event-sourcing/outbox/templating/templateContext";
import { validateLiquid } from "~/server/event-sourcing/outbox/templating/validate";

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

/** The four template columns, as edited in the drawer. Each may be null
 *  ("use the framework default") or omitted. */
export interface TemplateDraft {
  slackTemplateType?: string | null;
  slackTemplate?: string | null;
  emailSubjectTemplate?: string | null;
  emailBodyTemplate?: string | null;
}

/** The trigger identity a template renders against, supplied by the draft so
 *  preview/test-fire work before the automation is saved. */
export interface DraftIdentity {
  name: string;
  alertType: AlertType | null;
  message: string | null;
}

export interface DraftProject {
  name: string;
  slug: string;
}

export interface TemplateDefaults {
  emailSubject: string;
  emailBody: string;
  slackString: string;
  slackBlockKit: string;
}

export interface TemplateScaffold {
  defaults: TemplateDefaults;
  /** Dotted variable paths a template can reference (editor autocomplete). */
  variables: string[];
  /** The example data preview renders against, for the author to inspect. */
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

/** A template column failed `validateLiquid` (or an invalid Slack type). */
export class TemplateValidationError extends Error {
  name = "TemplateValidationError" as const;
  constructor(
    readonly field: keyof TemplateDraft,
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
] as const satisfies readonly (keyof TemplateDraft)[];

const PLACEHOLDER_IDENTITY: DraftIdentity = {
  name: "Your automation",
  alertType: null,
  message: null,
};

function normalizeSlackType(raw: string | null | undefined): SlackTemplateType | null {
  if (raw === "block_kit") return "block_kit";
  if (raw === "string") return "string";
  return null;
}

/**
 * Validates a template draft before it is persisted: every non-empty Liquid
 * column must parse, and `slackTemplateType` must be a recognised discriminator.
 * Throws `TemplateValidationError` on the first problem. Pure, so the save path
 * (route) and unit tests can both call it.
 */
export function validateTemplateDraft(draft: TemplateDraft): void {
  if (
    draft.slackTemplateType != null &&
    !(SLACK_TEMPLATE_TYPES as readonly string[]).includes(draft.slackTemplateType)
  ) {
    throw new TemplateValidationError(
      "slackTemplateType",
      `Invalid Slack template type "${draft.slackTemplateType}"`,
    );
  }
  for (const column of LIQUID_TEMPLATE_COLUMNS) {
    const source = draft[column];
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
}

/**
 * Renders trigger-notification templates for the authoring drawer. Operates
 * purely on the draft payload — the trigger/project identity and template
 * sources are supplied by the caller (see ADR-028), so preview and test fire
 * work identically before a trigger is saved (create) and after (edit). The
 * rendering itself lives in the `outbox/templating` module; this service builds
 * the example context around it and dispatches a test fire via the notifier.
 */
export class TriggerTemplateService {
  private readonly baseHost: string;
  private readonly notifier: TriggerNotifier;

  constructor(deps: { baseHost: string; notifier: TriggerNotifier }) {
    this.baseHost = deps.baseHost;
    this.notifier = deps.notifier;
  }

  getScaffold({ project }: { project: DraftProject }): TemplateScaffold {
    return {
      defaults: {
        emailSubject: DEFAULT_EMAIL_SUBJECT_TEMPLATE,
        emailBody: DEFAULT_EMAIL_BODY_TEMPLATE,
        slackString: DEFAULT_SLACK_TEMPLATE,
        slackBlockKit: DEFAULT_SLACK_BLOCK_KIT_TEMPLATE,
      },
      variables: TEMPLATE_VARIABLE_PATHS,
      example: this.context(PLACEHOLDER_IDENTITY, project),
    };
  }

  async renderPreview({
    channel,
    trigger,
    project,
    draft,
  }: {
    channel: TemplateChannel;
    trigger: DraftIdentity;
    project: DraftProject;
    draft: TemplateDraft;
  }): Promise<TemplatePreview> {
    const context = this.context(trigger, project);

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
      templateType: normalizeSlackType(draft.slackTemplateType),
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
    channel,
    trigger,
    project,
    draft,
    recipients,
    webhook,
  }: {
    channel: TemplateChannel;
    trigger: DraftIdentity;
    project: DraftProject;
    draft: TemplateDraft;
    recipients: string[];
    webhook: string | null;
  }): Promise<TestFireResult> {
    const context = this.context(trigger, project);

    if (channel === "email") {
      if (recipients.length === 0) {
        throw new TestFireUnavailableError(
          "This automation has no email recipients to test-fire to.",
        );
      }
      const rendered = await renderTriggerEmail({
        subjectTemplate: draft.emailSubjectTemplate ?? null,
        bodyTemplate: draft.emailBodyTemplate ?? null,
        context,
        testFire: true,
      });
      await this.notifier.sendEmail({
        to: recipients,
        subject: rendered.subject,
        html: rendered.html,
      });
      return {
        channel: "email",
        recipientCount: recipients.length,
        usedDefault: rendered.usedDefault,
        missingVariables: rendered.missingVariables,
        errors: rendered.errors,
      };
    }

    if (!webhook) {
      throw new TestFireUnavailableError(
        "This automation has no Slack webhook to test-fire to.",
      );
    }
    const rendered = await renderTriggerSlack({
      templateType: normalizeSlackType(draft.slackTemplateType),
      template: draft.slackTemplate ?? null,
      context,
      testFire: true,
    });
    await this.notifier.sendSlack({ webhook, payload: rendered.payload });
    return {
      channel: "slack",
      recipientCount: 1,
      usedDefault: rendered.usedDefault,
      missingVariables: rendered.missingVariables,
      errors: rendered.errors,
    };
  }

  private context(
    identity: DraftIdentity,
    project: DraftProject,
  ): TemplateContext {
    return buildTemplateContext({
      trigger: {
        id: "preview",
        name: identity.name,
        message: identity.message ?? "",
        alertType: identity.alertType,
      },
      project,
      baseHost: this.baseHost,
      matches: EXAMPLE_MATCHES,
    });
  }
}
