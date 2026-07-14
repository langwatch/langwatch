import type { AlertType } from "@prisma/client";
import { computeDefaultFrom } from "~/server/mailer/emailSender";
import {
  buildTriggerNoReplyAddress,
  TEST_FIRE_TRIGGER_ID_SENTINEL,
} from "~/server/mailer/triggerNoReply";
import { EXAMPLE_MATCHES } from "~/shared/templating/exampleContext";
import { renderTriggerEmail } from "~/shared/templating/renderEmail";
import {
  renderTriggerSlack,
  type SlackPayload,
  type SlackTemplateType,
} from "~/shared/templating/renderSlack";
import {
  buildTemplateContext,
  type TemplateContext,
} from "~/shared/templating/templateContext";
import { validateLiquid } from "~/shared/templating/validate";
import { TemplateValidationError, TestFireUnavailableError } from "./errors";

export type TemplateChannel = "email" | "slack";

export const SLACK_TEMPLATE_TYPES = ["string", "block_kit"] as const;

/** Sends a test-fire notification. Injected so the service is testable without
 *  hitting SES/SendGrid or a real Slack webhook. */
export interface TriggerNotifier {
  sendEmail(args: {
    /** Single visible recipient (the LangWatch no-reply for production
     *  triggers). All actual recipients ride in `bcc` so they don't see each
     *  other and can't be enumerated by external mailing-list integrations. */
    to: string;
    bcc: string[];
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
 *  test-fire works before the automation is saved. */
export interface DraftIdentity {
  name: string;
  alertType: AlertType | null;
}

export interface DraftProject {
  name: string;
  slug: string;
}

export interface TestFireResult {
  channel: TemplateChannel;
  recipientCount: number;
  usedDefault: boolean;
  missingVariables: string[];
  errors: string[];
}

const LIQUID_TEMPLATE_COLUMNS = [
  "slackTemplate",
  "emailSubjectTemplate",
  "emailBodyTemplate",
] as const satisfies readonly (keyof TemplateDraft)[];

function normalizeSlackType(
  raw: string | null | undefined,
): SlackTemplateType | null {
  return raw != null &&
    (SLACK_TEMPLATE_TYPES as readonly string[]).includes(raw)
    ? (raw as SlackTemplateType)
    : null;
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
    !(SLACK_TEMPLATE_TYPES as readonly string[]).includes(
      draft.slackTemplateType,
    )
  ) {
    throw new TemplateValidationError(
      "slackTemplateType",
      `Invalid Slack template type "${draft.slackTemplateType}". Allowed: ${SLACK_TEMPLATE_TYPES.join(", ")}.`,
    );
  }
  // ADR-036 makes the Slack type discriminator explicit so a Block Kit JSON
  // template can't silently dispatch as plain text. Reject a Slack source
  // without a type instead of falling back to "string", which is the kind of
  // silent mis-send the discriminator exists to prevent.
  const slackSource = draft.slackTemplate;
  if (
    typeof slackSource === "string" &&
    slackSource.trim() !== "" &&
    draft.slackTemplateType == null
  ) {
    throw new TemplateValidationError(
      "slackTemplateType",
      `slackTemplate is set but slackTemplateType is missing. Pick "string" or "block_kit".`,
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
 * Dispatches the "Send test" notification from the authoring drawer. Lives
 * server-side because it touches credentials (SES, Slack webhooks). Live
 * preview rendering happens entirely client-side via the same shared
 * templating module — the renderers below are imported from
 * `~/shared/templating/*` so both sides see identical output for any given
 * draft.
 */
export class TriggerTemplateService {
  private readonly baseHost: string;
  private readonly notifier: TriggerNotifier;

  constructor(deps: { baseHost: string; notifier: TriggerNotifier }) {
    this.baseHost = deps.baseHost;
    this.notifier = deps.notifier;
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

    // Run the same validation save uses so a Test Fire can't bypass the
    // discriminator contract — without this, a draft with `slackTemplate`
    // set but `slackTemplateType` unset would have `normalizeSlackType`
    // collapse to null and quietly render the framework default while
    // (from the operator's POV) "testing" their template. Validate first,
    // dispatch second.
    validateTemplateDraft(draft);

    if (channel === "email") {
      if (recipients.length === 0) {
        throw new TestFireUnavailableError(
          "email",
          "This automation has no email recipients to test-fire to.",
        );
      }
      const rendered = await renderTriggerEmail({
        subjectTemplate: draft.emailSubjectTemplate ?? null,
        bodyTemplate: draft.emailBodyTemplate ?? null,
        context,
        testFire: true,
      });
      const noReplyTo = buildTriggerNoReplyAddress({
        defaultFrom: computeDefaultFrom(),
        triggerId: TEST_FIRE_TRIGGER_ID_SENTINEL,
      });
      await this.notifier.sendEmail({
        to: noReplyTo,
        bcc: recipients,
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
        "slack",
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
        alertType: identity.alertType,
      },
      project,
      baseHost: this.baseHost,
      matches: EXAMPLE_MATCHES,
    });
  }
}
