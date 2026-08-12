import { SLACK_BOT_TOKEN_KEPT } from "@langwatch/automations/providers/slack";
import { WEBHOOK_HEADER_VALUE_KEPT } from "@langwatch/automations/providers/webhook";
import { createLogger } from "@langwatch/observability";
import { TriggerAction } from "@prisma/client";
import { ZodEffects, ZodObject, type ZodTypeAny } from "zod";
import { InvalidActionParamsError } from "./errors";
import {
  persistActionParamsFor,
  redactActionParamsFor,
  SERVER_PROVIDERS,
} from "./providers/registry";
import type { ServerEntry } from "./providers/types";

/**
 * The public API's delivery-credential contract, both directions.
 *
 * Reading: the dashboard read (`redactTriggerForRead`) leans on the provider
 * registry — each provider owns which of its stored fields are secret and what
 * the composer needs back to round-trip an edit. The public API read
 * (`redactTriggerForPublicApi`) is stricter, because its responses are machine
 * output: logged, piped into files, pasted into agent transcripts. Every field
 * that holds a delivery credential comes back as a fixed placeholder there, so
 * an integrator still sees which channel is configured and which header names
 * are set without the values ever travelling.
 *
 * Writing: read-modify-write is the normal integration shape, so a save
 * (`persistPublicApiActionParams`) has to mean "keep the stored credential"
 * wherever the caller sent back what it was given. Every save goes through the
 * provider's own persist hook, which is what owns the at-rest form — the
 * encrypted Slack bot token (ADR-041), the encrypted webhook header values and
 * signing secret (ADR-040 §3). The wire name and the at-rest name differ for
 * those, and the hook is the only thing that knows both.
 *
 * Both directions are structured: the fields that carry credentials are
 * declared per delivery channel and handled by name. Nothing here inspects
 * free prose looking for something secret-shaped.
 */

const logger = createLogger("langwatch:automations:trigger-redaction");

/** What a delivery credential reads as on the public API. Stable: clients and
 *  agents match on it, and a save reads it as "keep what is stored", so a
 *  read-modify-write round trip never overwrites a live credential with this
 *  string. */
export const REDACTED_CREDENTIAL = "[redacted]";

/**
 * The `actionParams` fields that hold a delivery credential, per channel, and
 * how each one's "keep the stored value" reaches the provider that owns it.
 *
 *  - `provider` — the value is encrypted at rest under a different name, and
 *    the provider's persist hook already resolves its own kept sentinel
 *    against the stored ciphertext. The placeholder is translated into that
 *    sentinel and the hook does the rest.
 *  - `row` — the value is stored in plain form under the same name and the
 *    persist hook copies whatever it is handed, so the stored value is
 *    substituted here before the hook runs.
 *
 * Slack: an incoming webhook URL is a bearer credential — whoever holds the
 * URL can post to the channel — and it is stored as it is given. The bot token
 * is encrypted (ADR-041). Webhook: static header values (ADR-040 §1) and the
 * HMAC signing secret (ADR-040 §3), both encrypted. Channels absent from this
 * map carry no credential in their `actionParams` — a dataset id, an
 * annotation queue id, an email address.
 */
const CREDENTIAL_FIELDS: Partial<
  Record<TriggerAction, Readonly<Record<string, "provider" | "row">>>
> = {
  [TriggerAction.SEND_SLACK_MESSAGE]: {
    slackWebhook: "row",
    slackBotToken: "provider",
  },
  [TriggerAction.SEND_WEBHOOK]: {
    headers: "provider",
    signingSecret: "provider",
  },
};

/** The sentinel each channel's persist hook reads as "keep what is stored". */
const KEPT_SENTINELS: Partial<Record<TriggerAction, string>> = {
  [TriggerAction.SEND_SLACK_MESSAGE]: SLACK_BOT_TOKEN_KEPT,
  [TriggerAction.SEND_WEBHOOK]: WEBHOOK_HEADER_VALUE_KEPT,
};

/** What a channel's persist hook reads as a complete set rather than as an
 *  optional field. The webhook provider treats `headers` that way — every save
 *  states the full record — so an omitted one means "no headers" and has to
 *  arrive as the empty record it means. */
const WIRE_DEFAULTS: Partial<Record<TriggerAction, Record<string, unknown>>> = {
  [TriggerAction.SEND_WEBHOOK]: { headers: {} },
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
  try {
    const read = redactTriggerForRead(trigger);
    return {
      ...read,
      actionParams: replaceCredentialsWithPlaceholder(
        trigger.action,
        read.actionParams,
      ),
    };
  } catch (error) {
    // Reading a row's stored secrets can fail on its own — a row saved while a
    // different credentials secret was in force cannot be decrypted by this
    // one. That row still lists: its delivery configuration comes back empty
    // rather than taking the whole listing with it.
    logger.warn(
      { error, action: trigger.action },
      "trigger delivery configuration could not be read; returning it empty",
    );
    return { ...trigger, actionParams: {} };
  }
}

/**
 * Prepare `actionParams` from a public API write for storage.
 *
 * The delivery configuration goes through the provider's persist hook, so the
 * at-rest form is whatever that provider says it is. Before the hook runs,
 * each credential the caller sent back as the placeholder is turned into
 * something the hook reads as "keep what is stored": the channel's own kept
 * sentinel where the hook resolves it, the stored value itself where the field
 * is kept in plain form. A placeholder with nothing stored behind it is
 * dropped rather than saved.
 *
 * Only the delivery configuration is the provider's to rule on. `actionParams`
 * also carries the rule an automation fires by — a graph alert's threshold, a
 * report's source and schedule — and a provider states its own fields
 * exhaustively, dropping anything it does not recognise so a channel can never
 * keep another channel's stale credential. So the two are separated by the
 * channel's own schema, the hook decides the delivery half, and the rule half
 * is carried across untouched (the same split the dashboard save makes).
 *
 * Slicing by the current channel alone holds because an update cannot change a
 * trigger's `action`: the channel that owns the stored delivery fields is the
 * same one that owns the incoming ones. Make the channel switchable and the
 * split has to widen to the union of every provider's field names, or the
 * outgoing channel's credentials would be carried across as if they were the
 * rule the automation fires by.
 */
export async function persistPublicApiActionParams({
  action,
  incoming,
  stored,
}: {
  action: TriggerAction;
  incoming: unknown;
  stored?: unknown;
}): Promise<unknown> {
  const resolved = resolveCredentialPlaceholders({ action, incoming, stored });

  const entry = SERVER_PROVIDERS[action] as ServerEntry | undefined;
  // No provider claims this action — a row naming a channel this server no
  // longer offers. There is no at-rest form to prepare, so the payload is
  // stored as it was sent; the read still declines to return it.
  if (!entry || !isRecord(resolved)) return resolved;

  const { delivery, rule } = splitDeliveryFromRule(
    resolved,
    deliveryFieldNames(entry.shared.actionParamsSchema),
  );
  const persisted = await persistActionParamsFor(action, {
    incoming: readDeliveryConfiguration(
      entry.shared.actionParamsSchema,
      delivery,
    ),
    loadExisting: async () => stored,
  });
  return { ...rule, ...(isRecord(persisted) ? persisted : {}) };
}

/**
 * The delivery configuration read by the schema its channel publishes — the
 * same one the dashboard save is held to, so an https-only destination, a
 * Slack connection with no channel or a dataset row with no mapping is refused
 * here exactly as it is there.
 *
 * It runs after the placeholders are resolved, never before: a caller writing
 * back what it read is stating the credential it already has, and a channel
 * asked to read `[redacted]` as a destination would refuse a round trip the
 * API promises is safe.
 */
function readDeliveryConfiguration(
  schema: ZodTypeAny,
  delivery: Record<string, unknown>,
): unknown {
  const read = schema.safeParse(delivery);
  if (read.success) return read.data;

  const issue = read.error.issues[0];
  throw new InvalidActionParamsError(
    issue?.message ?? "This delivery configuration cannot be used.",
    issue?.path.join(".") || undefined,
  );
}

/** The fields a channel declares as its own, read off the schema it publishes
 *  for them. A schema that is not an object shape claims nothing by name, and
 *  the whole payload goes to the hook as it did before — which is why every
 *  provider's schema is held to an object shape by
 *  `provider-delivery-fields.unit.test.ts`. Exported for that test. */
export function deliveryFieldNames(schema: ZodTypeAny): Set<string> {
  let current: ZodTypeAny = schema;
  while (current instanceof ZodEffects) current = current.innerType();
  if (current instanceof ZodObject) {
    return new Set(Object.keys(current.shape as Record<string, unknown>));
  }
  return new Set();
}

function splitDeliveryFromRule(
  params: Record<string, unknown>,
  deliveryFields: Set<string>,
): { delivery: Record<string, unknown>; rule: Record<string, unknown> } {
  if (deliveryFields.size === 0) return { delivery: params, rule: {} };

  const delivery: Record<string, unknown> = {};
  const rule: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(params)) {
    if (deliveryFields.has(key)) delivery[key] = value;
    else rule[key] = value;
  }
  return { delivery, rule };
}

function resolveCredentialPlaceholders({
  action,
  incoming,
  stored,
}: {
  action: TriggerAction;
  incoming: unknown;
  stored: unknown;
}): unknown {
  if (!isRecord(incoming)) return incoming;

  const fields = CREDENTIAL_FIELDS[action];
  const resolved: Record<string, unknown> = {
    ...WIRE_DEFAULTS[action],
    ...incoming,
  };
  if (!fields) return resolved;

  const storedRecord = isRecord(stored) ? stored : {};
  for (const [field, mechanism] of Object.entries(fields)) {
    if (!(field in resolved)) continue;
    const value = credentialToSave({
      mechanism,
      field,
      value: resolved[field],
      sentinel: KEPT_SENTINELS[action],
      stored: storedRecord,
    });
    if (value === DROP) delete resolved[field];
    else resolved[field] = value;
  }
  return resolved;
}

/** Nothing to save: the caller sent the placeholder for a credential this
 *  automation has never had. */
const DROP = Symbol("drop");

/** One credential field on its way to storage: handed to the provider's hook
 *  as that channel's kept sentinel, or resolved here against the row for a
 *  field the hook stores exactly as it is given. */
function credentialToSave({
  mechanism,
  field,
  value,
  sentinel,
  stored,
}: {
  mechanism: "provider" | "row";
  field: string;
  value: unknown;
  sentinel: string | undefined;
  stored: Record<string, unknown>;
}): unknown {
  if (mechanism === "provider") return withKeptSentinel(value, sentinel);
  if (value !== REDACTED_CREDENTIAL) return value;
  return field in stored ? stored[field] : DROP;
}

/** The placeholder, wherever it sits in a credential field, becomes the
 *  channel's kept sentinel. A record of header names carries one per value. */
function withKeptSentinel(
  value: unknown,
  sentinel: string | undefined,
): unknown {
  if (sentinel === undefined) return value;
  if (value === REDACTED_CREDENTIAL) return sentinel;
  if (isRecord(value)) {
    return Object.fromEntries(
      Object.entries(value).map(([name, entry]) => [
        name,
        withKeptSentinel(entry, sentinel),
      ]),
    );
  }
  return value;
}

function replaceCredentialsWithPlaceholder(
  action: TriggerAction,
  params: unknown,
): unknown {
  if (!isRecord(params)) return params;
  const fields = CREDENTIAL_FIELDS[action];
  if (!fields) return params;

  const redacted: Record<string, unknown> = { ...params };
  for (const field of Object.keys(fields)) {
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
