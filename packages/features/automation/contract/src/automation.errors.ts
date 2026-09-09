import { HandledError, NotFoundError } from "@langwatch/handled-error";

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

/**
 * A graph alert or a scheduled report was asked to do something it cannot.
 *
 * Both kinds are notifications: they deliver by email, Slack or webhook and
 * have nowhere to put a row. `ADD_TO_DATASET` and `ADD_TO_ANNOTATION_QUEUE`
 * belong to a trace-filter automation, which has traces to add. The two
 * builders have always said so in their types; nothing refused it at the
 * door, so such a trigger was stored and then never delivered.
 */
export class TriggerActionUnsupportedError extends HandledError {
  declare readonly code: "trigger_action_unsupported";

  constructor(
    public readonly triggerKind: "graph alert" | "report",
    public readonly action: string,
  ) {
    super(
      "trigger_action_unsupported",
      `A ${triggerKind} cannot ${action === "ADD_TO_DATASET" ? "add to a dataset" : "add to an annotation queue"}; it can only send a notification.`,
      { meta: { field: "action", triggerKind, action }, httpStatus: 422 },
    );
    this.name = "TriggerActionUnsupportedError";
  }
}

export class TemplateValidationError extends HandledError {
  declare readonly code: "template_validation_error";

  constructor(
    public readonly field: string,
    public readonly syntaxError: string,
  ) {
    super("template_validation_error", `Template "${field}" failed validation: ${syntaxError}`, {
      meta: { field, syntaxError },
      httpStatus: 422,
    });
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
    super("missing_slack_bot_token", "A Slack bot token is required for a bot connection.", {
      meta: { field: "slackBotToken" },
      httpStatus: 422,
    });
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
    super("missing_slack_webhook", "A Slack webhook URL is required for Slack automations.", {
      meta: { field: "slackWebhook" },
      httpStatus: 422,
    });
    this.name = "MissingSlackWebhookError";
  }
}

export class NotificationDeliveryError extends HandledError {
  declare readonly code: "notification_delivery_error";

  constructor(message: string, options: { customerMessage?: string } = {}) {
    const customerMeta = options.customerMessage ? { message: options.customerMessage } : {};

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

// ---------------------------------------------------------------------------
// The refusals the application names.
//
// Each one has a cause we can name and an action the caller can take, which is
// what makes it a `HandledError` rather than a transport error a door builds
// for itself. Every status below is the status that door already answered
// with: this move renamed the channel, never the outcome.
// ---------------------------------------------------------------------------

/** One automation, looked up in a project that does not have it. */
export class AutomationNotInProjectError extends NotFoundError {
  declare readonly code: "automation_not_found";

  constructor(triggerId: string, projectId: string) {
    super("automation_not_found", "Automation", triggerId, { meta: { projectId } });
    this.name = "AutomationNotInProjectError";
  }
}

/** The custom graph a graph alert names does not belong to the project. */
export class GraphNotInProjectError extends NotFoundError {
  declare readonly code: "graph_not_found";

  constructor(customGraphId: string, projectId: string) {
    super("graph_not_found", "Graph", customGraphId, { meta: { projectId } });
    this.name = "GraphNotInProjectError";
  }
}

/**
 * The legacy create mutation cannot carry the validated, encrypted webhook
 * destination shape, so a webhook automation has to be written by the
 * provider-aware upsert.
 */
export class AutomationWebhookUpsertRequiredError extends HandledError {
  declare readonly code: "automation_webhook_upsert_required";

  constructor() {
    super(
      "automation_webhook_upsert_required",
      "Webhook automations must be created through the provider-aware upsert API.",
      { httpStatus: 400 },
    );
    this.name = "AutomationWebhookUpsertRequiredError";
  }
}

/** The webhook delivery channel is not switched on for this project (ADR-040 §7). */
export class AutomationWebhookNotEnabledError extends HandledError {
  declare readonly code: "automation_webhook_not_enabled";

  constructor(projectId: string) {
    super(
      "automation_webhook_not_enabled",
      "Webhook automations are not enabled for this project.",
      { httpStatus: 403, meta: { projectId } },
    );
    this.name = "AutomationWebhookNotEnabledError";
  }
}

/**
 * Every condition on the saved automation names a field this platform no
 * longer supports, so saving it would leave the automation matching nothing an
 * author could still see.
 */
export class AutomationFiltersUnsupportedError extends HandledError {
  declare readonly code: "automation_filters_unsupported";

  constructor(unknownFields: readonly string[]) {
    super(
      "automation_filters_unsupported",
      "This automation only contains unsupported legacy filters. Add at least one supported filter before saving.",
      { httpStatus: 400, meta: { fields: [...unknownFields] } },
    );
    this.name = "AutomationFiltersUnsupportedError";
  }
}

/** The author's trace-filter query does not compile. */
export class AutomationTraceFilterInvalidError extends HandledError {
  declare readonly code: "automation_trace_filter_invalid";

  constructor(reason: string) {
    super("automation_trace_filter_invalid", `Invalid trace filter: ${reason}`, {
      httpStatus: 400,
      meta: { reason },
    });
    this.name = "AutomationTraceFilterInvalidError";
  }
}

/** Resuming a report whose stored schedule can no longer be read. */
export class ReportScheduleMissingError extends HandledError {
  declare readonly code: "report_schedule_missing";

  constructor() {
    super(
      "report_schedule_missing",
      "This report has no valid schedule. Edit it and pick a schedule before resuming it.",
      { httpStatus: 400 },
    );
    this.name = "ReportScheduleMissingError";
  }
}

/** A report renders a notification, so it can only use a notification channel. */
export class ReportChannelUnsupportedError extends HandledError {
  declare readonly code: "report_channel_unsupported";

  constructor() {
    super("report_channel_unsupported", "Reports can only send Email or Slack notifications.", {
      httpStatus: 400,
    });
    this.name = "ReportChannelUnsupportedError";
  }
}

/** A graph alert fires a notification; there is no "add to dataset on a breach". */
export class GraphAlertChannelUnsupportedError extends HandledError {
  declare readonly code: "graph_alert_channel_unsupported";

  constructor() {
    super(
      "graph_alert_channel_unsupported",
      "Graph alerts only support notify channels (Email, Slack, or a webhook).",
      { httpStatus: 400 },
    );
    this.name = "GraphAlertChannelUnsupportedError";
  }
}

/** A graph alert without a threshold rule has no condition to fire on. */
export class GraphAlertThresholdRequiredError extends HandledError {
  declare readonly code: "graph_alert_threshold_required";

  constructor() {
    super(
      "graph_alert_threshold_required",
      "Graph alerts require a threshold rule (operator, threshold, time period, series).",
      { httpStatus: 400 },
    );
    this.name = "GraphAlertThresholdRequiredError";
  }
}

/** A graph alert says how loud it is; without a severity it cannot be routed. */
export class GraphAlertSeverityRequiredError extends HandledError {
  declare readonly code: "graph_alert_severity_required";

  constructor() {
    super("graph_alert_severity_required", "Graph alerts require an alert severity.", {
      httpStatus: 400,
    });
    this.name = "GraphAlertSeverityRequiredError";
  }
}

/**
 * Hygiene on the test-fire button, not anti-abuse: the recipient is always the
 * requester, so this exists to stop a stuck client looping on the mail
 * provider or on a customer's own webhook receiver (ADR-040 §4).
 */
export class TestFireRateLimitedError extends HandledError {
  declare readonly code: "test_fire_rate_limited";

  constructor(message: string, resetAt: number) {
    super("test_fire_rate_limited", message, {
      httpStatus: 429,
      retryable: true,
      meta: { resetAt },
    });
    this.name = "TestFireRateLimitedError";
  }
}

/**
 * The unauthenticated unsubscribe pair, throttled per client address (ADR-031).
 * Public, so it is a surface an attacker can hammer to brute-force tokens.
 */
export class UnsubscribeRateLimitedError extends HandledError {
  declare readonly code: "unsubscribe_rate_limited";

  constructor() {
    super("unsubscribe_rate_limited", "Too many requests. Please try again shortly.", {
      httpStatus: 429,
      retryable: true,
    });
    this.name = "UnsubscribeRateLimitedError";
  }
}

/**
 * The token in an unsubscribe link is invalid, tampered with, or names a
 * project that no longer exists.
 *
 * The status is the caller's, not the cause's: resolving a link that resolves
 * to nothing has always been a 404, and confirming with a token that does not
 * verify has always been a 400. One code, because it is one cause and one
 * remedy - ask for the link again.
 */
export class UnsubscribeLinkInvalidError extends HandledError {
  declare readonly code: "unsubscribe_link_invalid";

  constructor(message: string, httpStatus: 400 | 404) {
    super("unsubscribe_link_invalid", message, { httpStatus });
    this.name = "UnsubscribeLinkInvalidError";
  }
}
