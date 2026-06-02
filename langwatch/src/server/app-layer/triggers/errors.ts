import { DomainError } from "~/server/app-layer/domain-error";

/**
 * Domain errors raised by the automation authoring path (ADR-026). Each is a
 * concrete `DomainError` subclass so the existing tRPC `errorFormatter`
 * serialises it onto the wire as `error.data.domainError` with the `kind`
 * discriminator plus structured `meta`. The client matches on `kind` and
 * renders field-targeted, actionable errors (highlight the offending field,
 * list the offending recipient, etc.) rather than a generic toast.
 *
 * `kind` strings stay stable across versions — the client uses them as a
 * discriminator, exactly like the existing `EvaluationNotFoundError` flow.
 */

export class TemplateValidationError extends DomainError {
  constructor(
    /** Template field that failed to parse — `emailSubjectTemplate`,
     *  `emailBodyTemplate`, `slackTemplate`, or `slackTemplateType`. */
    public readonly field: string,
    /** Human-readable Liquid syntax error from `validateLiquid`. */
    public readonly syntaxError: string,
  ) {
    super(
      "template_validation_error",
      `Template "${field}" failed validation: ${syntaxError}`,
      {
        meta: { field, syntaxError },
        httpStatus: 422,
      },
    );
    this.name = "TemplateValidationError";
  }
}

export class TestFireUnavailableError extends DomainError {
  constructor(
    public readonly channel: "email" | "slack",
    /** Why the test fire can't be sent (no recipients, no webhook, …). */
    reason: string,
  ) {
    super("test_fire_unavailable", reason, {
      meta: { channel, reason },
      httpStatus: 400,
    });
    this.name = "TestFireUnavailableError";
  }
}

/**
 * Held in reserve for a future "strict mode" on the project — when an
 * admin disables external recipients for compliance, this is the error
 * raised by the validation pass. The active route no longer throws it
 * by default; external emails are allowed everywhere with a UI badge.
 */
export class RecipientNotInTeamError extends DomainError {
  constructor(
    public readonly recipient: string,
    public readonly teamEmails: string[],
  ) {
    super(
      "recipient_not_in_team",
      `Recipient ${recipient} is not a member of this team.`,
      {
        meta: { recipient, teamEmails },
        httpStatus: 422,
      },
    );
    this.name = "RecipientNotInTeamError";
  }
}

/**
 * An email address failed RFC-shape validation. Carries the offending
 * recipient so the UI can highlight the chip that needs fixing.
 */
export class InvalidEmailRecipientError extends DomainError {
  constructor(public readonly recipient: string) {
    super(
      "invalid_email_recipient",
      `"${recipient}" is not a valid email address.`,
      {
        meta: { recipient },
        httpStatus: 422,
      },
    );
    this.name = "InvalidEmailRecipientError";
  }
}

export class MissingSlackWebhookError extends DomainError {
  constructor() {
    super(
      "missing_slack_webhook",
      "A Slack webhook URL is required for Slack automations.",
      { meta: { field: "slackWebhook" }, httpStatus: 422 },
    );
    this.name = "MissingSlackWebhookError";
  }
}

export class MissingAnnotatorError extends DomainError {
  constructor() {
    super(
      "missing_annotator",
      "At least one annotator is required for annotation-queue automations.",
      { meta: { field: "annotators" }, httpStatus: 422 },
    );
    this.name = "MissingAnnotatorError";
  }
}

export class ProjectNotFoundError extends DomainError {
  constructor(public readonly projectId: string) {
    super("project_not_found", `Project not found: ${projectId}`, {
      meta: { projectId },
      httpStatus: 404,
    });
    this.name = "ProjectNotFoundError";
  }
}
