import { DispatchError } from "~/server/event-sourcing/outbox/dispatchError";
import type { SlackPayload } from "~/shared/templating/renderSlack";
import { sendHttpDestination } from "./httpDestination";

const CHAT_POST_MESSAGE_URL = "https://slack.com/api/chat.postMessage";

/**
 * Slack Web API errors that clear on their own — a retry is worth taking. Rate
 * limiting, timeouts, and Slack-side blips fall here; everything else (bad
 * token, missing channel, malformed blocks) is a permanent misconfiguration a
 * retry can never fix, so it dead-letters.
 */
const RETRYABLE_SLACK_ERRORS = new Set([
  "rate_limited",
  "ratelimited",
  "internal_error",
  "service_unavailable",
  "fatal_error",
  "request_timeout",
  "server_error",
  "backend_error",
]);

interface SlackApiResponse {
  ok: boolean;
  error?: string;
  response_metadata?: { messages?: string[] };
}

/**
 * Post a message through the Slack Web API (`chat.postMessage`) with a bot
 * token — the delivery surface that renders the newer Block Kit blocks (charts,
 * tables, alerts) that incoming webhooks reject.
 *
 * A thin Slack-specific layer over the shared {@link sendHttpDestination}
 * primitive (ADR-040): the primitive owns the SSRF-fenced transport, timeout,
 * and retryable/terminal classification of transport failures; this layer adds
 * the bearer auth + JSON body and interprets Slack's response. `chat.postMessage`
 * returns HTTP 200 even on logical failure, carrying the real outcome in the
 * JSON `ok` flag, so success is decided off the body — and the Slack error code
 * (plus any `response_metadata.messages`, e.g. the exact invalid block) is
 * surfaced and re-classified for the outbox drainer.
 */
export async function postSlackChatMessage({
  token,
  channel,
  payload,
  triggerName,
}: {
  token: string;
  channel: string;
  payload: SlackPayload;
  triggerName: string;
}): Promise<void> {
  const label = `Slack Web API dispatch for trigger "${triggerName}"`;
  const response = await sendHttpDestination({
    url: CHAT_POST_MESSAGE_URL,
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json; charset=utf-8",
    },
    body: JSON.stringify({ channel, ...payload }),
    contextLabel: label,
  });

  // Transport 429 / 5xx (before Slack parsed a body) — transient.
  if (response.status === 429 || response.status >= 500) {
    throw new DispatchError({
      message: `${label}: HTTP ${response.status}`,
      retryable: true,
    });
  }

  let body: SlackApiResponse;
  try {
    body = JSON.parse(response.body) as SlackApiResponse;
  } catch {
    throw new DispatchError({
      message: `${label}: unparseable response (HTTP ${response.status})`,
      retryable: response.status >= 500,
    });
  }

  if (body.ok) return;

  const code = body.error ?? "unknown_error";
  const detail = body.response_metadata?.messages?.length
    ? ` (${body.response_metadata.messages.join("; ")})`
    : "";
  throw new DispatchError({
    message: `${label}: Slack rejected the message: ${code}${detail}`,
    retryable: RETRYABLE_SLACK_ERRORS.has(code),
  });
}
