import type { SlackPayload } from "@langwatch/automations/templating/renderSlack";
import { DispatchError } from "@langwatch/eventing";
import { createLogger } from "@langwatch/observability";
import { sendHttpDestination } from "~/server/webhooks/httpDestination";
import { webhookUrlValidator } from "~/server/webhooks/urlPolicy";

const logger = createLogger("langwatch:triggers:slackWebApi");

const CHAT_POST_MESSAGE_URL = "https://slack.com/api/chat.postMessage";
const CONVERSATIONS_LIST_URL = "https://slack.com/api/conversations.list";

/**
 * The Slack Web API calls are the last outbound sends that ran without a
 * pinned validator, which left them on the default env-gated policy and
 * following up to ten redirects — the weakest of the three callers of the
 * shared transport, and the one carrying a customer's bot token.
 *
 * Both destinations are constants under `slack.com`, and both answer a POST
 * with 200 directly, so refusing redirects costs nothing: a 3xx here would
 * mean the host is not the Slack we compiled in, which is precisely the case
 * where the token must not be re-sent.
 */
const validateSlackApiUrl = webhookUrlValidator(false);

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
 *
 * `null` for a code with no remediation we can vouch for. The caller ships this
 * to the customer verbatim, so anything returned here has to be a sentence
 * written FOR one — and `ratelimited` or `fatal_error` is a provider slug, not
 * copy. Those get the registry's own "Check the destination and try again."
 * instead; the code still travels in the log line.
 */
function explainSlackPostError(code: string): string | null {
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
    validateUrl: validateSlackApiUrl,
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
  const explanation = explainSlackPostError(code);
  throw new DispatchError({
    message: `${label}: ${explanation ?? `Slack rejected the message: ${code}`}${detail}`,
    retryable: RETRYABLE_SLACK_ERRORS.has(code),
    // Slack told us what the admin has to do; that sentence is the whole value
    // of this failure, so it travels to them. Capitalised because
    // `explainSlackPostError` writes a clause to follow the label, and this is
    // read on its own. `label` and `detail` stay behind: one names an internal
    // dispatcher, the other is raw provider metadata.
    //
    // Only when there IS one. Omitting the property is what makes the registry
    // fall back to its own copy for `notification_delivery_error` — see
    // NotificationDeliveryError. Sending `Slack rejected the message:
    // ratelimited` instead would put a provider slug in front of a customer,
    // which is neither remediation nor English.
    ...(explanation
      ? {
          customerMessage: `${explanation.charAt(0).toUpperCase()}${explanation.slice(1)}`,
        }
      : {}),
  });
}

export interface SlackChannel {
  id: string;
  name: string;
  isPrivate: boolean;
}

/**
 * Why a channel listing is short of the workspace. A listing can succeed and
 * still be incomplete, and the two are indistinguishable to the caller unless
 * we say so — which is the whole reason this type exists.
 *
 *   - `page_cap` — the walk stopped before Slack ran out of channels. Slack
 *     documents that "it's possible to receive fewer results than your
 *     specified limit, even when there are additional results to retrieve", so
 *     a page can carry a fraction of what we ask for. The real ceiling is
 *     therefore well under `pages x limit`, varies by workspace, and cannot be
 *     predicted from the page size — which is why the cap has to be reported
 *     rather than reasoned about.
 *   - `private_channels_hidden` — the app has no `groups:read`, so the listing
 *     fell back to public channels only.
 */
export type SlackChannelListGap = "page_cap" | "private_channels_hidden";

export interface SlackChannelListing {
  channels: SlackChannel[];
  error: string | null;
  /** Empty when the listing covers the whole workspace. */
  gaps: SlackChannelListGap[];
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
): Promise<SlackChannelListing> {
  const collected: SlackChannel[] = [];
  // Sorting happens here, AFTER any truncation, so a capped walk yields a list
  // that reads as alphabetical and complete while missing entries throughout.
  // That is why a silent cap is so misleading: the holes look like absence, not
  // truncation.
  const done = (
    error: string | null,
    gaps: SlackChannelListGap[] = [],
  ): SlackChannelListing => ({
    channels: [...collected].sort((a, b) => a.name.localeCompare(b.name)),
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
        validateUrl: validateSlackApiUrl,
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
): Promise<SlackChannelListing> {
  const withPrivate = await listChannelsForTypes(
    token,
    "public_channel,private_channel",
  );
  if (withPrivate.error !== "missing_scope") return withPrivate;
  // Missing `groups:read` (private) — fall back to public channels only. The
  // retry succeeds, so without recording the gap the caller would see a clean
  // listing and no reason to doubt it.
  const publicOnly = await listChannelsForTypes(token, "public_channel");
  // Only a listing that came back is missing something. If the retry failed too
  // there is no list to be partial, and the error is the whole story.
  if (publicOnly.error !== null) return publicOnly;
  return {
    ...publicOnly,
    gaps: [...publicOnly.gaps, "private_channels_hidden"],
  };
}
