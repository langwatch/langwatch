import { TriggerAction } from "@prisma/client";
import { redactActionParamsFor } from "./providers/registry";

/**
 * How a trigger row's `actionParams` are stripped of delivery credentials
 * before they leave the server, for the two read surfaces the platform has.
 *
 * The dashboard read (`redactTriggerForRead`) leans on the provider registry:
 * each provider owns which of its stored fields are secret and what the
 * composer needs back to round-trip an edit.
 *
 * The public API read (`redactTriggerForPublicApi`) is stricter, because its
 * responses are machine output — logged, piped into files, pasted into agent
 * transcripts. Every field that holds a delivery credential comes back as a
 * fixed placeholder there, so an integrator still sees which channel is
 * configured and which header names are set without the values ever travelling.
 *
 * Both are structured: the fields that carry credentials are declared per
 * delivery channel and substituted by name. Nothing here inspects free prose
 * looking for something secret-shaped.
 */

/** What a delivery credential reads as on the public API. Stable: clients and
 *  agents match on it, and the write path treats it as "keep what is stored"
 *  so a read-modify-write round trip cannot overwrite a live credential with
 *  this string. */
export const REDACTED_CREDENTIAL = "[redacted]";

/**
 * The `actionParams` fields that hold a delivery credential, per channel.
 *
 * Slack: an incoming webhook URL is a bearer credential — whoever holds the
 * URL can post to the channel. The bot token is already dropped by the
 * provider's own redaction, and is listed so the rule reads completely.
 * Webhook: static header values (ADR-040 §1) and the HMAC signing secret
 * (ADR-040 §3). Channels absent from this map carry no credential in their
 * `actionParams` — a dataset id, an annotation queue id, an email address.
 */
const CREDENTIAL_FIELDS: Partial<Record<TriggerAction, readonly string[]>> = {
  [TriggerAction.SEND_SLACK_MESSAGE]: ["slackWebhook", "slackBotToken"],
  [TriggerAction.SEND_WEBHOOK]: ["headers", "signingSecret"],
};

/** Strip secrets from a trigger row before it leaves the server via the
 *  provider registry's redact hook: the encrypted Slack bot token (ADR-041)
 *  and webhook header values (ADR-040 §3 — names echo with the kept
 *  sentinel, values never return). Identity for every other action. */
export function redactTriggerForRead<
  T extends { action: TriggerAction; actionParams: unknown },
>(trigger: T): T {
  return {
    ...trigger,
    actionParams: redactActionParamsFor(
      trigger.action,
      trigger.actionParams ?? {},
    ),
  };
}

/** The public API read: the provider's own redaction, then the placeholder on
 *  every declared credential field. A legacy row naming a channel this server
 *  no longer offers comes back with empty `actionParams`, which is how
 *  `redactActionParamsFor` fails closed. */
export function redactTriggerForPublicApi<
  T extends { action: TriggerAction; actionParams: unknown },
>(trigger: T): T {
  const read = redactTriggerForRead(trigger);
  return {
    ...read,
    actionParams: replaceCredentialsWithPlaceholder(
      trigger.action,
      read.actionParams,
    ),
  };
}

function replaceCredentialsWithPlaceholder(
  action: TriggerAction,
  params: unknown,
): unknown {
  if (!isRecord(params)) return params;
  const fields = CREDENTIAL_FIELDS[action];
  if (!fields) return params;

  const redacted: Record<string, unknown> = { ...params };
  for (const field of fields) {
    if (!(field in redacted)) continue;
    redacted[field] = placeholderFor(redacted[field]);
  }
  return redacted;
}

/** A credential's shape survives; only its value goes. A record of header
 *  names keeps its names, an absent or unset credential stays absent or
 *  unset — `signingSecret: null` means the deliveries are unsigned, which is
 *  a fact about the automation rather than a secret. */
function placeholderFor(value: unknown): unknown {
  if (value === null || value === undefined || value === "") return value;
  if (isRecord(value)) {
    return Object.fromEntries(
      Object.entries(value).map(([name, entry]) => [
        name,
        placeholderFor(entry),
      ]),
    );
  }
  return REDACTED_CREDENTIAL;
}

/**
 * The write half of the placeholder: an integrator who reads an automation,
 * edits a field and writes the whole object back sends the placeholder for
 * every credential they did not touch. Each of those keeps the stored value;
 * a placeholder with nothing stored behind it is dropped rather than saved.
 * Everything else is passed through exactly as sent.
 */
export function resolveRedactedCredentials({
  incoming,
  stored,
}: {
  incoming: unknown;
  stored: unknown;
}): unknown {
  if (!isRecord(incoming)) return incoming;
  const storedRecord = isRecord(stored) ? stored : {};

  const resolved: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(incoming)) {
    if (value === REDACTED_CREDENTIAL) {
      if (key in storedRecord) resolved[key] = storedRecord[key];
      continue;
    }
    if (isRecord(value)) {
      resolved[key] = resolveRedactedCredentials({
        incoming: value,
        stored: storedRecord[key],
      });
      continue;
    }
    resolved[key] = value;
  }
  return resolved;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
