import { DispatchError } from "~/server/event-sourcing/queues/dispatchError";
import type { SlackPayload } from "~/shared/templating/renderSlack";
import { createLogger } from "@langwatch/observability";
import { sendHttpDestination } from "./httpDestination";

const logger = createLogger("langwatch:triggers:slackWebApi");

const CHAT_POST_MESSAGE_URL = "https://slack.com/api/chat.postMessage";
const CONVERSATIONS_LIST_URL = "https://slack.com/api/conversations.list";

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
 * Turn a raw Slack `chat.postMessage` error code into a message that tells the
 * author what to actually do. The bare codes (`not_in_channel`,
 * `channel_not_found`) are the top setup snags and read as opaque in a toast —
 * a bot posting to a public channel it hasn't joined needs either an invite or
 * the `chat:write.public` scope, and a bad channel value needs the picker.
 */
function explainSlackPostError(code: string): string {
  switch (code) {
    case "not_in_channel":
      return "the bot isn't in that channel. Invite it with `/invite @LangWatch` in the channel, or reinstall the Slack app with the `chat:write.public` scope so it can post to any public channel";
    case "channel_not_found":
      return "that channel doesn't exist or the bot can't see it. Pick it from the channel list, or paste the channel ID (e.g. C0123ABCD) instead of the name";
    case "is_archived":
      return "that channel is archived — pick an active channel";
    case "invalid_auth":
    case "not_authed":
    case "token_revoked":
    case "account_inactive":
      return "the bot token is invalid or was revoked. Paste a fresh Bot User OAuth token (starts with `xoxb-`)";
    case "missing_scope":
      return "the Slack app is missing a required scope. Reinstall it with the `chat:write` (and `chat:write.public`) scopes";
    default:
      return `Slack rejected the message: ${code}`;
  }
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
    message: `${label}: ${explainSlackPostError(code)}${detail}`,
    retryable: RETRYABLE_SLACK_ERRORS.has(code),
  });
}

export interface SlackChannel {
  id: string;
  name: string;
  isPrivate: boolean;
}

interface SlackConversationsResponse {
  ok: boolean;
  error?: string;
  channels?: { id: string; name: string; is_private?: boolean }[];
  response_metadata?: { next_cursor?: string };
}

/**
 * Conversations per page. Slack's own guidance is to stay well under its 1000
 * ceiling — large pages routinely time out server-side — and a smaller page
 * keeps each response comfortably inside {@link CHANNEL_LIST_MAX_RESPONSE_BYTES}.
 */
const CHANNEL_PAGE_SIZE = 200;
/** Hard stop on paging, so a pathological workspace can't spin the request. */
const MAX_CHANNEL_PAGES = 10;
/**
 * A conversations.list entry is ~0.7-1.5 KB of JSON, so a full page can run to
 * ~300 KB — far past the shared 64 KiB default, which would truncate the body
 * mid-string and make it unparseable. This body is PARSED, not just logged, so
 * it needs a cap sized for the payload (with headroom), not for a log snippet.
 */
const CHANNEL_LIST_MAX_RESPONSE_BYTES = 1024 * 1024;

/**
 * One cursor-paged `conversations.list` walk for a specific `types` set. Slack
 * pages by cursor, so a real workspace needs the full walk — one page is only
 * ever a prefix. A failure part-way through returns the channels gathered so
 * far ALONGSIDE the error, so a caller can still offer what it has.
 */
async function listChannelsForTypes(
  token: string,
  types: string,
): Promise<{ channels: SlackChannel[]; error: string | null }> {
  const collected: SlackChannel[] = [];
  const done = (error: string | null) => ({
    channels: [...collected].sort((a, b) => a.name.localeCompare(b.name)),
    error,
  });

  let cursor: string | undefined;

  for (let page = 0; page < MAX_CHANNEL_PAGES; page++) {
    const params = new URLSearchParams({
      types,
      exclude_archived: "true",
      limit: String(CHANNEL_PAGE_SIZE),
    });
    if (cursor) params.set("cursor", cursor);

    let response: { status: number; body: string };
    try {
      response = await sendHttpDestination({
        url: CONVERSATIONS_LIST_URL,
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: params.toString(),
        maxResponseBytes: CHANNEL_LIST_MAX_RESPONSE_BYTES,
        contextLabel: "Slack conversations.list",
      });
    } catch {
      return done("request_failed");
    }

    let body: SlackConversationsResponse;
    try {
      body = JSON.parse(response.body) as SlackConversationsResponse;
    } catch {
      return done("bad_response");
    }
    if (!body.ok) return done(body.error ?? "unknown_error");

    for (const channel of body.channels ?? []) {
      collected.push({
        id: channel.id,
        name: channel.name,
        isPrivate: !!channel.is_private,
      });
    }

    // Slack signals "no more pages" with an absent or empty next_cursor.
    cursor = body.response_metadata?.next_cursor || undefined;
    if (!cursor) return done(null);
  }

  logger.warn(
    { pages: MAX_CHANNEL_PAGES, channels: collected.length },
    "Slack conversations.list page cap reached; returning a partial channel list",
  );
  return done(null);
}

/**
 * List the channels a bot token can see (`conversations.list`) so the config
 * form can offer a channel picker.
 *
 * Slack rejects the WHOLE request with `missing_scope` if ANY requested type
 * lacks its scope — so asking for `private_channel` (needs `groups:read`) fails
 * outright for an app that only has `channels:read`, taking the public channels
 * down with it. We degrade instead: try public+private, and on `missing_scope`
 * retry public-only. An app with just `channels:read` then still gets its public
 * channels; only an app missing `channels:read` too ends up with `missing_scope`.
 */
export async function listSlackChannels(
  token: string,
): Promise<{ channels: SlackChannel[]; error: string | null }> {
  const withPrivate = await listChannelsForTypes(
    token,
    "public_channel,private_channel",
  );
  if (withPrivate.error !== "missing_scope") return withPrivate;
  // Missing `groups:read` (private) — fall back to public channels only.
  return listChannelsForTypes(token, "public_channel");
}
