import { HandledError, NotFoundError } from "@langwatch/handled-error";

export class AutomationNotFoundError extends Error {
  constructor() {
    super("Automation not found");
    this.name = "AutomationNotFoundError";
  }
}
/** No automation with that id in this project. Also what a caller sees for an
 *  automation belonging to another project: an id it may not read is an id
 *  that does not exist. */
export class TriggerNotFoundError extends HandledError {
  declare readonly code: "trigger_not_found";

  constructor() {
    super("trigger_not_found", "This automation no longer exists.", {
      httpStatus: 404,
    });
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
 * Every condition on the automation names a field this platform no longer
 * filters on. Distinct from having no condition at all: the author wrote
 * conditions, they just cannot be acted on.
 */
export class TriggerFiltersUnsupportedError extends HandledError {
  declare readonly code: "trigger_filters_unsupported";

  constructor(public readonly unknownFields: string[]) {
    super(
      "trigger_filters_unsupported",
      "None of this automation's conditions can be used. Add at least one " +
        "condition this platform can act on.",
      { meta: { field: "filters", unknownFields }, httpStatus: 422 },
    );
    this.name = "TriggerFiltersUnsupportedError";
  }
}

/**
 * The channel an automation delivers on is fixed when it is created: the
 * credential rules that let a caller write back what it read need the incoming
 * and stored delivery configuration to share one channel. Refused, not ignored.
 */
export class TriggerActionImmutableError extends HandledError {
  declare readonly code: "trigger_action_immutable";

  constructor(
    /** The channel this automation delivers on and keeps delivering on. */
    public readonly action: string,
  ) {
    super(
      "trigger_action_immutable",
      "An automation keeps the delivery channel it was created with. " +
        "Create a new automation on the channel you want.",
      { meta: { field: "action", action }, httpStatus: 422 },
    );
    this.name = "TriggerActionImmutableError";
  }
}

/**
 * A trace automation, a graph alert and a scheduled report are different kinds
 * of row: an alert owns its graph's alert slot and a report a calendar entry,
 * so converting one is a create and a delete, never an edit.
 */
export class TriggerKindImmutableError extends HandledError {
  declare readonly code: "trigger_kind_immutable";

  constructor(
    /** What this automation is: `automation`, `alert` or `report`. */
    public readonly kind: string,
  ) {
    super(
      "trigger_kind_immutable",
      "This automation cannot be turned into a different kind of automation. " +
        "Create the one you want and delete this one.",
      { meta: { field: "kind", kind }, httpStatus: 422 },
    );
    this.name = "TriggerKindImmutableError";
  }
}

/**
 * The delivery configuration named fields the channel does not have. Refused,
 * not dropped: `slackChannelID` for `slackChannelId` used to save cleanly and
 * deliver nowhere, and an update replaces the stored configuration whole.
 */
export class TriggerActionParamsUnknownFieldsError extends HandledError {
  declare readonly code: "trigger_action_params_unknown_fields";

  /** The fields this channel does not have, in the order they were sent. */
  public readonly fields: string[];
  /** Every field it does have, so the caller can see the one it meant. */
  public readonly accepted: string[];

  constructor({ fields, accepted }: { fields: string[]; accepted: string[] }) {
    super(
      "trigger_action_params_unknown_fields",
      "This delivery configuration names fields the channel does not have.",
      { meta: { field: "actionParams", fields, accepted }, httpStatus: 422 },
    );
    this.fields = fields;
    this.accepted = accepted;
    this.name = "TriggerActionParamsUnknownFieldsError";
  }
}

/**
 * The rule an automation fires by was sent inside its delivery configuration.
 * `graphAlert` and `report` are top-level wire fields; inside `actionParams`
 * the stored rule overwrote them, so the save answered 200 and changed nothing.
 */
export class TriggerRuleFieldsMisplacedError extends HandledError {
  declare readonly code: "trigger_rule_fields_misplaced";

  /** The rule fields that arrived in the wrong place. */
  public readonly fields: string[];
  /** Where they belong: `graphAlert` or `report`. */
  public readonly expectedField: "graphAlert" | "report";

  constructor({
    fields,
    expectedField,
  }: {
    fields: string[];
    expectedField: "graphAlert" | "report";
  }) {
    super(
      "trigger_rule_fields_misplaced",
      `The rule this automation fires by is stated in "${expectedField}", not ` +
        "in its delivery configuration.",
      { meta: { field: "actionParams", fields, expectedField }, httpStatus: 422 },
    );
    this.fields = fields;
    this.expectedField = expectedField;
    this.name = "TriggerRuleFieldsMisplacedError";
  }
}

/**
 * Too many test fires in too short a window. A test fire sends to an address
 * the caller chose (ADR-040 §4), so uncapped it is a flood primitive driven
 * from an API key; the cap is per project, the identity behind the call.
 */
export class TriggerTestFireRateLimitedError extends HandledError {
  declare readonly code: "trigger_test_fire_rate_limited";

  constructor(
    /** Epoch ms the current window ends at. */
    public readonly resetAt: number,
  ) {
    super(
      "trigger_test_fire_rate_limited",
      "Too many test fires for this project. Wait for the current minute to " +
        "pass and try again.",
      { meta: { resetAt }, httpStatus: 429 },
    );
    this.name = "TriggerTestFireRateLimitedError";
  }
}

/** A graph alert was saved without something it needs to fire: the rule it
 *  fires by, the severity it fires at, or a channel that can notify. */
export class GraphAlertIncompleteError extends HandledError {
  declare readonly code: "graph_alert_incomplete";

  /** What is missing or wrong: `graphAlert`, `alertType`, `action`. */
  public readonly field: string;
  /** Which piece is missing, for whoever has to add it. Travels in `meta`
   *  because an error's own message no longer crosses the tRPC wire (#5984). */
  public readonly reason: string;

  constructor({ field, reason }: { field: string; reason: string }) {
    super("graph_alert_incomplete", reason, {
      meta: { field, reason },
      httpStatus: 422,
    });
    this.field = field;
    this.reason = reason;
    this.name = "GraphAlertIncompleteError";
  }
}

/** The alert names a graph this project does not have. Also what a caller sees
 *  for a graph in another project. */
export class GraphNotFoundError extends HandledError {
  declare readonly code: "graph_not_found";

  constructor() {
    super("graph_not_found", "This project has no graph with that id.", {
      meta: { field: "customGraphId" },
      httpStatus: 404,
    });
    this.name = "GraphNotFoundError";
  }
}

/**
 * A report was saved without what it renders and when it sends. Distinct from
 * a report on a channel that cannot carry one; this also answers a stored
 * report whose configuration can no longer be read.
 */
export class ReportIncompleteError extends HandledError {
  declare readonly code: "report_incomplete";

  constructor() {
    super(
      "report_incomplete",
      "A report needs to say what it sends and when. State its source and " + "its schedule.",
      { meta: { field: "report" }, httpStatus: 422 },
    );
    this.name = "ReportIncompleteError";
  }
}

/** The trace query the automation is about could not be read. Rejected at the
 *  save rather than at dispatch, where it would silently match nothing. The
 *  parser's own account stays in the thrower's log: it can name internal
 *  columns, and nothing on a handled error is allowed to. */
export class TriggerFilterQueryInvalidError extends HandledError {
  declare readonly code: "trigger_filter_query_invalid";

  constructor() {
    super(
      "trigger_filter_query_invalid",
      "This trace query could not be read. Check it against the query syntax " +
        "the traces view uses.",
      { meta: { field: "filterQuery" }, httpStatus: 422 },
    );
    this.name = "TriggerFilterQueryInvalidError";
  }
}

/** A keyed condition written as a bare list, e.g. `evaluations.passed` with no
 *  monitor. It names nothing to select by, so it would match no trace. */
export class TriggerFilterKeyRequiredError extends HandledError {
  declare readonly code: "trigger_filter_key_required";

  constructor({ field, example }: { field: string; example: string }) {
    super(
      "trigger_filter_key_required",
      `The "${field}" condition needs a key, so a bare list matches nothing. ` +
        `Write it nested: ${example}`,
      { meta: { field: "filters", filterField: field, example }, httpStatus: 422 },
    );
    this.name = "TriggerFilterKeyRequiredError";
  }
}

/** An evaluation condition keyed by an Evaluator's id. Results carry the id of
 *  the monitor that ran, so it would never match; the monitors using that
 *  evaluator are named so the caller can key by one of them. */
export class TriggerFilterMonitorRequiredError extends HandledError {
  declare readonly code: "trigger_filter_monitor_required";

  constructor({
    field,
    evaluatorId,
    monitorIds,
  }: {
    field: string;
    evaluatorId: string;
    monitorIds: string[];
  }) {
    const remedy =
      monitorIds.length > 0
        ? `Key it by a monitor that runs it instead: ${monitorIds.map((id) => `"${id}"`).join(", ")}.`
        : "No monitor in this project runs it yet; add one and key the " +
          "condition by the monitor's id.";
    super(
      "trigger_filter_monitor_required",
      `The "${field}" condition is keyed by "${evaluatorId}", which is an ` +
        "evaluator, not a monitor. Evaluation results carry the id of the " +
        `monitor that ran, so it would match nothing. ${remedy}`,
      {
        meta: { field: "filters", filterField: field, evaluatorId, monitorIds },
        httpStatus: 422,
      },
    );
    this.name = "TriggerFilterMonitorRequiredError";
  }
}

/**
 * A webhook automation's destination changed in the same save that kept the
 * stored header values. Header values belong to the endpoint they authenticate
 * against and a public-API caller never held them: send them with the new one.
 */
export class WebhookHeaderValuesRequiredError extends HandledError {
  declare readonly code: "webhook_header_values_required";

  constructor() {
    super(
      "webhook_header_values_required",
      "Changing the destination means sending the header values with it. " +
        "Include each header's value in the same request as the new URL.",
      { meta: { field: "headers" }, httpStatus: 422 },
    );
    this.name = "WebhookHeaderValuesRequiredError";
  }
}

/**
 * Graph alerts and reports are notifications without row destinations, so
 * ADD_TO_DATASET and ADD_TO_ANNOTATION_QUEUE are unsupported.
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
// The refusals the application names: each has a nameable cause and a
// caller action, making it a `HandledError`, not a door's own transport
// error. Every status is the one that door already answered with.
// ---------------------------------------------------------------------------

/** One automation, looked up in a project that does not have it. */
export class AutomationNotInProjectError extends NotFoundError {
  declare readonly code: "automation_not_found";

  constructor(triggerId: string, projectId: string) {
    super(
      "automation_not_found",
      { resource: "Automation", id: triggerId },
      { meta: { projectId } },
    );
    this.name = "AutomationNotInProjectError";
  }
}

/** The custom graph a graph alert names does not belong to the project. */
export class GraphNotInProjectError extends NotFoundError {
  declare readonly code: "graph_not_found";

  constructor(customGraphId: string, projectId: string) {
    super("graph_not_found", { resource: "Graph", id: customGraphId }, { meta: { projectId } });
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

/** A scheduled report was saved on a channel that cannot deliver one. */
export class ReportChannelUnsupportedError extends HandledError {
  declare readonly code: "report_channel_unsupported";

  constructor() {
    super(
      "report_channel_unsupported",
      "A report is delivered by email or to Slack. Pick one of those channels.",
      { meta: { field: "action" }, httpStatus: 422 },
    );
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
 * Unsubscribe token is invalid, tampered, or missing; one code covers both 404 and 400
 * errors with the same remedy.
 */
export class UnsubscribeLinkInvalidError extends HandledError {
  declare readonly code: "unsubscribe_link_invalid";

  constructor(message: string, httpStatus: 400 | 404) {
    super("unsubscribe_link_invalid", message, { httpStatus });
    this.name = "UnsubscribeLinkInvalidError";
  }
}

/** A capability the API process deliberately does not run, refused by name. */
export class ApiAutomationUnavailableError extends HandledError {
  declare readonly code: "service_unavailable";

  constructor(capability: string) {
    super("service_unavailable", `The API process does not ${capability}.`, {
      httpStatus: 503,
      fault: "platform",
    });
    this.name = "ApiAutomationUnavailableError";
  }
}
