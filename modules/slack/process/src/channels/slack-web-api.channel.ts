/** Which workspace a bot token belongs to, as Slack itself reports it. */
export interface SlackWorkspaceIdentity {
  teamId: string;
  teamName: string;
}

/** Slack's answer to `auth.test`: the identity, or Slack's own refusal code. */
export type SlackIdentityResult =
  | { ok: true; identity: SlackWorkspaceIdentity }
  | { ok: false; error: string };

/**
 * The failures that mean "no usable answer from Slack" rather than "Slack
 * refused this token". Slack's refusal codes are open-ended strings, so these
 * two are the whole reason a caller can tell infrastructure from a bad token.
 */
const SLACK_TRANSPORT_FAILURES = ["request_failed", "bad_response"] as const;
export type SlackTransportFailure = (typeof SLACK_TRANSPORT_FAILURES)[number];

export function isSlackTransportFailure(error: string): error is SlackTransportFailure {
  return SLACK_TRANSPORT_FAILURES.some((failure) => failure === error);
}

/** The save-time Slack Web API read (ADR-093 §5): who a bot token is. */
export abstract class SlackWebApiChannel {
  abstract fetchWorkspaceIdentity(input: { token: string }): Promise<SlackIdentityResult>;
}
