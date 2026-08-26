import { HandledError } from "@langwatch/handled-error";

export class AutomationNotFoundError extends Error {
  constructor() {
    super("Automation not found");
    this.name = "AutomationNotFoundError";
  }
}
export class TriggerNotFoundError extends Error {
  constructor() {
    super("Trigger not found");
    this.name = "TriggerNotFoundError";
  }
}
export class InvalidUnsubscribeTokenError extends Error {
  constructor() {
    super("Invalid or tampered unsubscribe token");
    this.name = "InvalidUnsubscribeTokenError";
  }
}

export class TriggerFiltersRequiredError extends HandledError {
  declare readonly code: "trigger_filters_required";

  constructor() {
    super(
      "trigger_filters_required",
      "An automation needs at least one condition. Add a filter or a query, otherwise it would fire on every single trace.",
      { meta: { field: "filters" }, httpStatus: 422 },
    );
    this.name = "TriggerFiltersRequiredError";
  }
}

export class TemplateValidationError extends HandledError {
  declare readonly code: "template_validation_error";

  constructor(
    public readonly field: string,
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
    reason: string,
  ) {
    super("test_fire_unavailable", reason, {
      meta: { channel, reason },
      httpStatus: 400,
    });
    this.name = "TestFireUnavailableError";
  }
}

export class InvalidEmailRecipientError extends HandledError {
  declare readonly code: "invalid_email_recipient";

  constructor(public readonly recipient: string) {
    super("invalid_email_recipient", `"${recipient}" is not a valid email address.`, {
      meta: { recipient },
      httpStatus: 422,
    });
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

export class NotificationDeliveryError extends HandledError {
  declare readonly code: "notification_delivery_error";

  constructor(message: string, options: { customerMessage?: string } = {}) {
    const customerMeta = options.customerMessage
      ? { message: options.customerMessage }
      : {};

    super("notification_delivery_error", message, {
      meta: { field: "slackChannelId", ...customerMeta },
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
