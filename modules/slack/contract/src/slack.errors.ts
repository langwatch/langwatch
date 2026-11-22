import { HandledError } from "@langwatch/handled-error";

import type { SlackConnectionClaimant } from "./slack.schemas.ts";

/**
 * Slack refused the bot token at setup (ADR-093 §5): setup validates against
 * `auth.test` before anything is stored, so nothing was written. Slack's own
 * code travels in `meta.slackError`; the presentation registry switches on it.
 */
export class SlackIntegrationInvalidTokenError extends HandledError {
  declare readonly code: "slack_integration_invalid_token";

  constructor(public readonly slackError: string) {
    super("slack_integration_invalid_token", "Slack did not accept that bot token.", {
      meta: { slackError },
      httpStatus: 422,
    });
    this.name = "SlackIntegrationInvalidTokenError";
  }
}

/**
 * Slack delivery had nothing to deliver with: the automation's connection is
 * gone or out of its project's reach, or it names none and stores no secret of
 * its own (ADR-093 §5a resolution). Customer fault: pick or add a connection.
 */
export class SlackIntegrationMissingError extends HandledError {
  declare readonly code: "slack_integration_missing";

  constructor() {
    super(
      "slack_integration_missing",
      "Connect Slack in this project's integration settings before sending this automation.",
      { httpStatus: 422 },
    );
    this.name = "SlackIntegrationMissingError";
  }
}

/**
 * The secret being saved is already stored in the scope being written, or in
 * the organization for a project write (ADR-093 §5a: one connection per scope).
 * The existing connection's name travels so the customer can pick it instead.
 */
export class SlackConnectionExistsError extends HandledError {
  declare readonly code: "slack_connection_exists";

  constructor({ connectionId, connectionName }: { connectionId: string; connectionName: string }) {
    super("slack_connection_exists", "This Slack secret is already saved as another connection.", {
      meta: { connectionId, connectionName },
      httpStatus: 409,
    });
    this.name = "SlackConnectionExistsError";
  }
}

/**
 * A connection automations still claim (ARCHITECTURE.md §3, the claims ruling):
 * a delete is refused while any claim exists, and a narrowing until confirmed.
 * The count and the claimants travel so the client can say what stops delivering.
 */
export class SlackConnectionInUseError extends HandledError {
  declare readonly code: "slack_connection_in_use";

  constructor({
    dependentAutomations,
    claimants,
  }: {
    dependentAutomations: number;
    claimants: SlackConnectionClaimant[];
  }) {
    super("slack_connection_in_use", "Automations still deliver through this Slack connection.", {
      meta: { dependentAutomations, claimants },
      httpStatus: 409,
    });
    this.name = "SlackConnectionInUseError";
  }
}

/** A Slack connection input was refused; the wire code matches main's automation refusal. */
export class InvalidSlackConnectionInputError extends HandledError {
  declare readonly code: "invalid_action_params";

  constructor(
    message: string,
    public readonly field?: string,
  ) {
    super("invalid_action_params", message, {
      meta: { field },
      httpStatus: 422,
    });
    this.name = "InvalidSlackConnectionInputError";
  }
}
