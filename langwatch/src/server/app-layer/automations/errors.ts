import { HandledError } from "@langwatch/handled-error";

/**
 * Domain errors raised by the automation authoring path (ADR-036). Each is a
 * concrete `HandledError` subclass so the existing tRPC `errorFormatter`
 * serialises it onto the wire as `error.data.error` with the `code`
 * discriminator plus structured `meta`. The client matches on `code` and
 * renders field-targeted, actionable errors (highlight the offending field,
 * list the offending recipient, etc.) rather than a generic toast.
 *
 * `code` strings stay stable across versions — the client uses them as a
 * discriminator, exactly like the existing `EvaluationNotFoundError` flow.
 */

export class TemplateValidationError extends HandledError {
  declare readonly code: "template_validation_error";

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

export class TestFireUnavailableError extends HandledError {
  declare readonly code: "test_fire_unavailable";

  constructor(
    public readonly channel: "email" | "slack" | "webhook",
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
 * An email address failed RFC-shape validation. Carries the offending
 * recipient so the UI can highlight the chip that needs fixing.
 */
export class InvalidEmailRecipientError extends HandledError {
  declare readonly code: "invalid_email_recipient";

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

export class MissingSlackBotTokenError extends HandledError {
  declare readonly code: "missing_slack_bot_token";

  constructor() {
    super(
      "missing_slack_bot_token",
      "A Slack bot token is required for a bot connection.",
      { meta: { field: "slackBotToken" }, httpStatus: 422 },
    );
    this.name = "MissingSlackBotTokenError";
  }
}

/**
 * A provider's `persistActionParams` hook rejected the wire payload — e.g.
 * webhook kept-header sentinels after the destination URL changed. Carries
 * the offending field so the drawer can target it.
 */
export class InvalidActionParamsError extends HandledError {
  declare readonly code: "invalid_action_params";

  constructor(
    message: string,
    public readonly field?: string,
  ) {
    super("invalid_action_params", message, {
      meta: { field },
      httpStatus: 422,
    });
    this.name = "InvalidActionParamsError";
  }
}

export class MissingSlackWebhookError extends HandledError {
  declare readonly code: "missing_slack_webhook";

  constructor() {
    super(
      "missing_slack_webhook",
      "A Slack webhook URL is required for Slack automations.",
      { meta: { field: "slackWebhook" }, httpStatus: 422 },
    );
    this.name = "MissingSlackWebhookError";
  }
}

/**
 * A test-fire reached the provider but delivery was rejected — a Slack
 * `not_in_channel` / `channel_not_found`, a dead webhook, a bad bot token. The
 * underlying `DispatchError` already carries an actionable, provider-specific
 * message (see `explainSlackPostError`); this lifts it onto the typed
 * `HandledError` channel so the drawer renders it as a clear 4xx instead of a
 * generic 500. `field` targets the channel input, the most common fix.
 */
export class NotificationDeliveryError extends HandledError {
  declare readonly code: "notification_delivery_error";

  constructor(message: string) {
    super("notification_delivery_error", message, {
      meta: { field: "slackChannelId" },
      httpStatus: 422,
    });
    this.name = "NotificationDeliveryError";
  }
}

export class MissingAnnotatorError extends HandledError {
  declare readonly code: "missing_annotator";

  constructor() {
    super(
      "missing_annotator",
      "At least one annotator is required for annotation-queue automations.",
      { meta: { field: "annotators" }, httpStatus: 422 },
    );
    this.name = "MissingAnnotatorError";
  }
}

export class ProjectNotFoundError extends HandledError {
  declare readonly code: "project_not_found";

  constructor(public readonly projectId: string) {
    super("project_not_found", `Project not found: ${projectId}`, {
      meta: { projectId },
      httpStatus: 404,
    });
    this.name = "ProjectNotFoundError";
  }
}
