/**
 * The public API's delivery-credential contract, both directions: a read
 * replaces every declared credential with a placeholder, a save reads it back
 * as "keep what is stored". Credentials are declared per channel, handled by name.
 */
import {
  annotationQueueProvider,
  datasetProvider,
  emailProvider,
  InvalidActionParamsError,
  slackProvider,
  TriggerAction,
  WEBHOOK_HEADER_VALUE_KEPT,
  graphAlertActionParamsSchema,
  reportActionParamsSchema,
  TriggerActionParamsUnknownFieldsError,
  TriggerRuleFieldsMisplacedError,
  WebhookHeaderValuesRequiredError,
  webhookProvider,
  type TriggerAction as TriggerActionValue,
  type TriggerKind,
} from "@langwatch/automation-contract";
import { z, type ZodType } from "zod";

/** What a delivery credential reads as on the public API. Clients and agents match on it. */
export const REDACTED_CREDENTIAL = "[redacted]";

/** The `actionParams` fields holding a delivery credential, per channel (ADR-040). */
const CREDENTIAL_FIELDS: Partial<Record<TriggerActionValue, readonly string[]>> = {
  [TriggerAction.SEND_WEBHOOK]: ["headers", "signingSecret"],
};

/** The sentinel each channel's persist hook reads as "keep what is stored". */
const KEPT_SENTINELS: Partial<Record<TriggerActionValue, string>> = {
  [TriggerAction.SEND_WEBHOOK]: WEBHOOK_HEADER_VALUE_KEPT,
};

/** A field the persist hook reads as a complete set: an omitted `headers` means none. */
const WIRE_DEFAULTS: Partial<Record<TriggerActionValue, Record<string, unknown>>> = {
  [TriggerAction.SEND_WEBHOOK]: { headers: {} },
};

const recordSchema = z.record(z.string(), z.unknown());

function isRecord(value: unknown): value is Record<string, unknown> {
  return recordSchema.validate(value);
}

/** The fields a channel declares as its own, read off the schema it publishes. */
export function deliveryFieldNames(schema: ZodType): Set<string> {
  return schema instanceof z.ZodObject ? new Set(Object.keys(schema.shape)) : new Set();
}

/** The schema each channel publishes for its delivery configuration. */
const CHANNEL_SCHEMAS: Record<TriggerActionValue, ZodType> = {
  [TriggerAction.SEND_EMAIL]: emailProvider.actionParamsSchema,
  [TriggerAction.SEND_SLACK_MESSAGE]: slackProvider.actionParamsSchema,
  [TriggerAction.SEND_WEBHOOK]: webhookProvider.actionParamsSchema,
  [TriggerAction.ADD_TO_DATASET]: datasetProvider.actionParamsSchema,
  [TriggerAction.ADD_TO_ANNOTATION_QUEUE]: annotationQueueProvider.actionParamsSchema,
};

export function channelActionParamsSchema(action: TriggerActionValue): ZodType {
  return CHANNEL_SCHEMAS[action];
}

/** Every field name any channel delivers by: one channel's field is delivery wherever found. */
const EVERY_CHANNELS_DELIVERY_FIELDS = new Set(
  Object.values(CHANNEL_SCHEMAS).flatMap((schema) => [...deliveryFieldNames(schema)]),
);

/** Where each kind states the rule it fires by, read off the schema that validates it. */
const RULE_FIELD_NAMES = {
  graphAlert: new Set(Object.keys(graphAlertActionParamsSchema.shape)),
  report: new Set(Object.keys(reportActionParamsSchema.shape)),
} as const;

/**
 * Hold a delivery configuration to the field names its channel publishes. The
 * channel is known, so the shape is never inferred; a rule field sent here is
 * refused, since it belongs in `graphAlert` or `report` and would be overwritten.
 */
export function assertActionParamsFieldsAreThisChannels({
  action,
  actionParams,
  kind,
}: {
  action: TriggerActionValue;
  actionParams: Record<string, unknown>;
  kind: TriggerKind;
}): void {
  const accepted = deliveryFieldNames(CHANNEL_SCHEMAS[action]);
  const unknown = Object.keys(actionParams).filter((field) => !accepted.has(field));
  if (unknown.length === 0) return;

  if (kind === "ALERT" || kind === "REPORT") {
    const ruleField = kind === "ALERT" ? "graphAlert" : "report";
    const misplaced = unknown.filter((field) => RULE_FIELD_NAMES[ruleField].has(field));
    if (misplaced.length > 0) {
      throw new TriggerRuleFieldsMisplacedError({ fields: misplaced, expectedField: ruleField });
    }
  }
  throw new TriggerActionParamsUnknownFieldsError({
    fields: unknown,
    accepted: [...accepted].toSorted(),
  });
}

/** Separate `actionParams` into where the automation delivers and the rule it fires by. */
export function splitStoredRuleFromDelivery(actionParams: unknown): {
  delivery: Record<string, unknown>;
  rule: Record<string, unknown>;
} {
  const delivery: Record<string, unknown> = {};
  const rule: Record<string, unknown> = {};
  if (!isRecord(actionParams)) return { delivery, rule };
  for (const [key, value] of Object.entries(actionParams)) {
    if (EVERY_CHANNELS_DELIVERY_FIELDS.has(key)) delivery[key] = value;
    else rule[key] = value;
  }
  return { delivery, rule };
}

/**
 * A header value or signing secret authenticates against the endpoint it was
 * issued for, so a save pointing the automation somewhere new sends them
 * again. Checked before placeholders resolve, so the caller is told what to do.
 */
export function assertHeaderValuesTravelWithTheirDestination({
  action,
  incoming,
  stored,
}: {
  action: TriggerActionValue;
  incoming: unknown;
  stored: unknown;
}): void {
  if (action !== TriggerAction.SEND_WEBHOOK) return;
  if (!isRecord(incoming) || !isRecord(stored)) return;
  if (incoming.url === stored.url) return;

  const headers = incoming.headers;
  const keepsAStoredValue =
    isRecord(headers) && Object.values(headers).some((value) => value === REDACTED_CREDENTIAL);
  if (keepsAStoredValue) throw new WebhookHeaderValuesRequiredError();
  if (incoming.signingSecret === REDACTED_CREDENTIAL) {
    throw new InvalidActionParamsError(
      "Changing the destination means sending the signing secret with it, or null to stop signing.",
      "signingSecret",
    );
  }
}

/** Each credential sent back as the placeholder becomes the channel's kept sentinel. */
export function resolveCredentialPlaceholders({
  action,
  incoming,
}: {
  action: TriggerActionValue;
  incoming: Record<string, unknown>;
}): Record<string, unknown> {
  const resolved: Record<string, unknown> = { ...WIRE_DEFAULTS[action], ...incoming };
  for (const field of CREDENTIAL_FIELDS[action] ?? []) {
    if (field in resolved)
      resolved[field] = withKeptSentinel(resolved[field], KEPT_SENTINELS[action]);
  }
  return resolved;
}

/**
 * The delivery configuration read by the schema its channel publishes, after
 * the placeholders resolved: a round trip states a credential it already has.
 */
export function readDeliveryConfiguration({
  schema,
  delivery,
}: {
  schema: ZodType;
  delivery: Record<string, unknown>;
}): Record<string, unknown> {
  const read = schema.safeParse(delivery);
  if (read.success) return recordSchema.parse(read.data);

  const [issue] = read.error.issues;
  throw new InvalidActionParamsError(
    issue?.message ?? "This delivery configuration cannot be used.",
    issue?.path.join(".") || undefined,
  );
}

/** A provider-redacted read with every declared credential replaced by the placeholder. */
export function replaceCredentialsWithPlaceholder({
  action,
  params,
}: {
  action: TriggerActionValue;
  params: unknown;
}): Record<string, unknown> {
  if (!isRecord(params)) return {};
  const redacted: Record<string, unknown> = { ...params };
  for (const field of CREDENTIAL_FIELDS[action] ?? []) {
    if (field in redacted) redacted[field] = placeholderFor(redacted[field]);
  }
  return redacted;
}

function withKeptSentinel(value: unknown, sentinel: string | undefined): unknown {
  if (sentinel === undefined) return value;
  if (value === REDACTED_CREDENTIAL) return sentinel;
  if (!isRecord(value)) return value;
  return Object.fromEntries(
    Object.entries(value).map(([name, entry]) => [name, withKeptSentinel(entry, sentinel)]),
  );
}

/** A credential's shape survives; only its value goes. `signingSecret: null` is a fact. */
function placeholderFor(value: unknown): unknown {
  if (value === null || value === undefined || value === "") return value;
  if (!isRecord(value)) return REDACTED_CREDENTIAL;
  return Object.fromEntries(
    Object.entries(value).map(([name, entry]) => [name, placeholderFor(entry)]),
  );
}
