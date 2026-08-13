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

/**
 * A trace automation was saved with nothing to narrow it: no structured filter
 * that selects anything, and no query. Such an automation matches every trace
 * forever, and its cost is paid per trace by the pipeline, not by whoever saved
 * it. Alerts and reports are exempt — their condition is a threshold or a
 * schedule, not a trace filter.
 */
export class TriggerFiltersRequiredError extends HandledError {
  declare readonly code: "trigger_filters_required";

  constructor() {
    super(
      "trigger_filters_required",
      "An automation needs at least one condition. Add a filter or a query, " +
        "otherwise it would fire on every single trace.",
      { meta: { field: "filters" }, httpStatus: 422 },
    );
    this.name = "TriggerFiltersRequiredError";
  }
}

/**
 * Every condition on the automation names a field this platform no longer
 * filters on, so nothing is left to narrow it. Distinct from having no
 * condition at all: the author wrote conditions, they just cannot be acted on.
 */
export class TriggerFiltersUnsupportedError extends HandledError {
  declare readonly code: "trigger_filters_unsupported";

  constructor(public readonly unknownFields: string[]) {
    super(
      "trigger_filters_unsupported",
      "None of this automation's conditions can be used. Add at least one " +
        "condition this platform can act on.",
      {
        meta: { field: "filters", unknownFields },
        httpStatus: 422,
      },
    );
    this.name = "TriggerFiltersUnsupportedError";
  }
}

/**
 * The channel an automation delivers on is fixed when it is created.
 *
 * This is not a limitation waiting to be lifted: the credential rules that let
 * a caller write back what it read depend on the incoming and the stored
 * delivery configuration belonging to the same channel (see the module doc in
 * `trigger-redaction.ts`). Refusing the change is how a caller finds out,
 * rather than having the field quietly ignored.
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
 * A trace automation, a graph alert and a scheduled report are three different
 * kinds of row, and an edit cannot turn one into another over the public API:
 * a graph alert owns its graph's alert slot and a report owns a calendar entry,
 * so converting one is a create and a delete rather than an edit.
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
 * The delivery configuration named fields the channel does not have.
 *
 * They are refused rather than dropped. A dropped field is the failure this
 * surface exists to remove: `slackChannelID` for `slackChannelId` saved
 * cleanly, answered 200, and delivered nowhere — and on an update it was worse
 * than useless, because the payload replaces the stored configuration whole.
 */
export class TriggerActionParamsUnknownFieldsError extends HandledError {
  declare readonly code: "trigger_action_params_unknown_fields";

  constructor(
    /** The fields this channel does not have, in the order they were sent. */
    public readonly fields: string[],
    /** Every field it does have, so the caller can see the one it meant. */
    public readonly accepted: string[],
  ) {
    super(
      "trigger_action_params_unknown_fields",
      "This delivery configuration names fields the channel does not have.",
      { meta: { field: "actionParams", fields, accepted }, httpStatus: 422 },
    );
    this.name = "TriggerActionParamsUnknownFieldsError";
  }
}

/**
 * The rule an automation fires by was sent inside its delivery configuration.
 *
 * The two live in one column at rest, but they are stated separately on the
 * wire: `graphAlert` and `report` are top-level fields. Sent inside
 * `actionParams` they used to be overwritten by the stored rule on the way to
 * storage, so the save answered 200 and changed nothing — the silent ignore
 * this surface exists to remove.
 */
export class TriggerRuleFieldsMisplacedError extends HandledError {
  declare readonly code: "trigger_rule_fields_misplaced";

  constructor(
    /** The rule fields that arrived in the wrong place. */
    public readonly fields: string[],
    /** Where they belong: `graphAlert` or `report`. */
    public readonly expectedField: "graphAlert" | "report",
  ) {
    super(
      "trigger_rule_fields_misplaced",
      `The rule this automation fires by is stated in "${expectedField}", not ` +
        "in its delivery configuration.",
      {
        meta: { field: "actionParams", fields, expectedField },
        httpStatus: 422,
      },
    );
    this.name = "TriggerRuleFieldsMisplacedError";
  }
}

/**
 * Too many test fires in too short a window.
 *
 * A test fire is the one verb here that makes LangWatch send something on the
 * caller's say-so, to an address the same caller chose: an email automation
 * states its own recipients, and a webhook one an arbitrary destination our
 * workers then request (ADR-040 §4). Uncapped, either is a flood primitive
 * driven from an API key. The cap is per project, because a project's API key
 * is the identity behind the call.
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

  constructor(
    /** What is missing or wrong — `graphAlert`, `alertType`, `action`. */
    public readonly field: string,
    /** Which piece is missing, written for whoever has to add it. Travels in
     *  `meta` because an error's own message no longer crosses the tRPC wire
     *  (#5984), and the generic line cannot name the missing piece. */
    public readonly reason: string,
  ) {
    super("graph_alert_incomplete", reason, {
      meta: { field, reason },
      httpStatus: 422,
    });
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
 * A report was saved without the two things it needs: what it renders and when
 * it sends.
 *
 * Distinct from a report on a channel that cannot carry one — the fix here is
 * to state the report, not to pick a different channel. The two are reached by
 * different routes: this one also answers a stored report whose configuration
 * can no longer be read, where the caller has to state it again.
 */
export class ReportIncompleteError extends HandledError {
  declare readonly code: "report_incomplete";

  constructor() {
    super(
      "report_incomplete",
      "A report needs to say what it sends and when. State its source and " +
        "its schedule.",
      { meta: { field: "report" }, httpStatus: 422 },
    );
    this.name = "ReportIncompleteError";
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

/** The trace query the automation is about could not be read. Rejected at the
 *  save rather than at dispatch, where it would silently match nothing. */
export class TriggerFilterQueryInvalidError extends HandledError {
  declare readonly code: "trigger_filter_query_invalid";

  constructor(
    /** The parser's own account of what it could not read. */
    public readonly reason: string,
  ) {
    super(
      "trigger_filter_query_invalid",
      "This trace query could not be read. Check it against the query syntax " +
        "the traces view uses.",
      { meta: { field: "filterQuery", reason }, httpStatus: 422 },
    );
    this.name = "TriggerFilterQueryInvalidError";
  }
}

/**
 * A webhook automation's destination changed in the same save that asked to
 * keep the stored header values.
 *
 * Header values are scoped to the endpoint they authenticate against, so they
 * do not travel to a new one. Over the public API a caller never held those
 * values — the read hands it the placeholder — so the remediation is not "type
 * them again" but "send them with the new destination": one call carrying the
 * new URL and each header's value saves both.
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
 * `not_in_channel` / `channel_not_found`, a dead webhook, a bad bot token.
 *
 * Some of those rejections come with real remediation (see
 * `explainSlackPostError`: "the bot isn't in that channel. Invite it with
 * `/invite @LangWatch`…") and that sentence is the entire value of this error —
 * a generic "check the destination" tells the user nothing they didn't know.
 * It travels in `meta.message`, the sanctioned opt-in channel for
 * server-authored prose (ADR-045), because since #5984 an error's own
 * `message` never crosses the wire.
 *
 * But only SOME of them. The `DispatchError` this is built from is also thrown
 * for transport failures, and those messages are assembled from an undici
 * string, a DNS result, and a context label naming how the feature is built
 * ("Slack Web API dispatch for trigger …"). Relaying the whole message
 * verbatim — which this class did — published all of it: the registry entry
 * for this code renders `meta.message` as-is.
 *
 * So the caller states which it is. `customerMessage` is prose WRITTEN for a
 * customer; without it the code travels alone and the registry falls back to
 * its own copy, which is calm and true rather than leaky and precise. `message`
 * stays the full diagnostic for the log line.
 *
 * `field` targets the channel input, the most common fix.
 */
export class NotificationDeliveryError extends HandledError {
  declare readonly code: "notification_delivery_error";

  constructor(
    message: string,
    options: {
      /**
       * The remediation sentence, unprefixed, as a person would write it.
       * Omit for a transport failure — there is nothing customer-safe to say
       * about a socket.
       */
      customerMessage?: string;
    } = {},
  ) {
    super("notification_delivery_error", message, {
      meta: {
        field: "slackChannelId",
        ...(options.customerMessage
          ? { message: options.customerMessage }
          : {}),
      },
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
