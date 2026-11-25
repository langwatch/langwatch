import type {
  SlackChannel,
  SlackChannelListGap,
  SlackChannelListing,
  SlackPayload,
} from "@langwatch/automation-contract";
import { DispatchError } from "@langwatch/eventing";
import { createLogger } from "@langwatch/observability";

const logger = createLogger("langwatch:triggers:slackWebApi");

const CHAT_POST_MESSAGE_URL = "https://slack.com/api/chat.postMessage";
const CONVERSATIONS_LIST_URL = "https://slack.com/api/conversations.list";

// Slack Web API calls carry bot tokens, so they must refuse redirects to
// prevent re-sending a token if the URL has changed.
export interface SlackApiTransport {
  request(input: {
    url: string;
    method: "POST";
    headers: Record<string, string>;
    body: string;
    contextLabel: string;
    maxResponseBytes?: number;
  }): Promise<{ status: number; body: string }>;
}

/**
 * Slack Web API errors that clear on their own -- rate limiting,
 * timeouts, Slack-side blips. Everything else (bad token, missing
 * channel, malformed blocks) is permanent misconfiguration, so it dead-letters.
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

// Translate Slack error codes to customer-safe remediation copy; null for
// codes without actionable guidance.
function findSlackPostErrorRemediation(code: string): string | null {
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
      return null;
  }
}

// Post a message via Slack Web API with a bot token; thin layer over
// {@link sendHttpDestination} (ADR-040) that interprets Slack's response.
async function postSlackChatMessage(
  {
    token,
    channel,
    payload,
    triggerName,
  }: {
    token: string;
    channel: string;
    payload: SlackPayload;
    triggerName: string;
  },
  transport: SlackApiTransport,
): Promise<void> {
  const label = `Slack Web API dispatch for trigger "${triggerName}"`;
  const response = await transport.request({
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
  const explanation = findSlackPostErrorRemediation(code);
  throw new DispatchError({
    message: `${label}: ${explanation ?? `Slack rejected the message: ${code}`}${detail}`,
    retryable: RETRYABLE_SLACK_ERRORS.has(code),
    // Include Slack's remediation when available; omit to let the registry
    // fall back to its own copy, avoiding provider slugs in customer-facing copy.
    ...(explanation
      ? {
          customerMessage: `${explanation.charAt(0).toUpperCase()}${explanation.slice(1)}`,
        }
      : {}),
  });
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
 * A conversations.list entry is ~0.7-1.5 KB, so a full page can run to
 * ~300 KB -- far past the shared 64 KiB default, which would truncate
 * and make this PARSED body unparseable.
 */
const CHANNEL_LIST_MAX_RESPONSE_BYTES = 1024 * 1024;

/**
 * One cursor-paged `conversations.list` walk for a `types` set. A
 * failure part-way returns the channels gathered so far ALONGSIDE the
 * error, so a caller can still offer what it has.
 */
async function listChannelsForTypes(
  token: string,
  types: string,
  transport: SlackApiTransport,
): Promise<SlackChannelListing> {
  const collected: SlackChannel[] = [];
  // Sorting happens here, AFTER any truncation, so a capped walk yields a list
  // that reads as alphabetical and complete while missing entries throughout.
  // That is why a silent cap is so misleading: the holes look like absence, not
  // truncation.
  const done = (error: string | null, gaps: SlackChannelListGap[] = []): SlackChannelListing => ({
    channels: [...collected].toSorted((a, b) => a.name.localeCompare(b.name)),
    error,
    gaps,
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
      response = await transport.request({
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
  return done(null, ["page_cap"]);
}

// List channels for the config form's channel picker; degrade to public-only
// on missing_scope to avoid losing all channels when private_channel scope is denied.
async function listSlackChannels(
  token: string,
  transport: SlackApiTransport,
): Promise<SlackChannelListing> {
  const withPrivate = await listChannelsForTypes(
    token,
    "public_channel,private_channel",
    transport,
  );
  if (withPrivate.error !== "missing_scope") return withPrivate;
  // Missing `groups:read` (private) — fall back to public channels only. The
  // retry succeeds, so without recording the gap the caller would see a clean
  // listing and no reason to doubt it.
  const publicOnly = await listChannelsForTypes(token, "public_channel", transport);
  // Only a listing that came back is missing something. If the retry failed too
  // there is no list to be partial, and the error is the whole story.
  if (publicOnly.error !== null) return publicOnly;
  return {
    ...publicOnly,
    gaps: [...publicOnly.gaps, "private_channels_hidden"],
  };
}

/** Process-owned Slack Web API adapter. The host supplies the pinned HTTP
 * transport once at composition time; request methods remain stateless. */
export class SlackWebApiDeliveryChannel {
  private constructor(private readonly transport: SlackApiTransport) {}

  static create(transport: SlackApiTransport): SlackWebApiDeliveryChannel {
    return new SlackWebApiDeliveryChannel(transport);
  }

  post(input: {
    token: string;
    channel: string;
    payload: SlackPayload;
    triggerName: string;
  }): Promise<void> {
    return postSlackChatMessage(input, this.transport);
  }

  list(token: string): Promise<SlackChannelListing> {
    return listSlackChannels(token, this.transport);
  }
}
