/**
 * What the audit trail is allowed to keep of a call's arguments.
 *
 * Moved here from the application unchanged, rules and keying included: the
 * scalar rule below is the only thing standing between a plaintext secret and
 * a durable, queryable table, and it is keyed by tRPC action path because the
 * field names it names are ordinary words other mutations use for harmless
 * things.
 */

/**
 * Fields on a model-provider write whose values are secrets. All three ride
 * the same `modelProvider.update` mutation: `customKeys` holds the API key as
 * typed, `providerConfig` is a passthrough object we do not get to police, and
 * `extraHeaders` is precisely where an `Authorization: Bearer …` is entered.
 */
const CREDENTIAL_OBJECT_FIELDS = ["customKeys", "providerConfig"] as const;

/**
 * Action paths whose input carries values a person typed for one run, keyed by
 * the field that holds them.
 *
 * `parameters` on a run can hold a credential: a scenario can declare a
 * parameter secret, and the value is supplied when the run starts.
 * `templateVariables` on the http test button is where the same person types a
 * test token. Both field names are ordinary words other mutations use for
 * harmless things, so the rule is bound to the action rather than to the name.
 *
 * The names are kept: "which parameters did this run set" is the part of the
 * record worth having.
 */
const REDACTED_VALUE_FIELDS_BY_ACTION: Record<string, readonly string[]> = {
  "suites.run": ["parameters"],
  "scenarios.run": ["parameters"],
  "httpProxy.execute": ["templateVariables"],
};

/**
 * Action paths whose input holds a credential directly in a field, rather than
 * inside an object. `redactObjectField` deliberately ignores a plain string, so
 * these would otherwise be stored as typed. `value` is an ordinary word other
 * mutations use for harmless things, so the rule is bound to the action.
 */
const REDACTED_SCALAR_FIELDS_BY_ACTION: Record<string, readonly string[]> = {
  "secrets.create": ["value"],
  "secrets.update": ["value"],
};

/** Keeps an object's field names, drops every value. */
function redactValues(source: Record<string, unknown>): Record<string, string> {
  return Object.fromEntries(Object.keys(source).map((name) => [name, "[redacted]"]));
}

/** The object fields whose values this action must not store. */
function redactedObjectFieldsFor(action?: string): readonly string[] {
  if (!action) return CREDENTIAL_OBJECT_FIELDS;
  return [...CREDENTIAL_OBJECT_FIELDS, ...(REDACTED_VALUE_FIELDS_BY_ACTION[action] ?? [])];
}

/**
 * The redacted form of one field, or undefined when the field holds nothing to
 * redact.
 *
 * No schema produces an array here, but a redactor has to fail safe on a shape
 * it did not expect rather than wave it through: the cost of guessing wrong is
 * a secret in a durable table.
 */
function redactObjectField(value: unknown): unknown {
  if (typeof value !== "object" || value === null) return undefined;
  return Array.isArray(value)
    ? value.map(() => "[redacted]")
    : redactValues(value as Record<string, unknown>);
}

/**
 * The redacted form of an `extraHeaders` list.
 *
 * A list of `{ key, value }` pairs rather than an object, so the header name
 * survives and only what it carries is dropped. An entry of any other shape is
 * replaced whole: a redactor cannot tell a name from a value in a shape it does
 * not know, and a header is where an `Authorization: Bearer …` is typed.
 */
function redactHeaderValues(headers: readonly unknown[]): unknown[] {
  return headers.map((header) => {
    if (typeof header !== "object" || header === null) return "[redacted]";
    const { key } = header as Record<string, unknown>;
    return typeof key === "string" ? { key, value: "[redacted]" } : "[redacted]";
  });
}

/**
 * Strips credential values out of what the audit trail persists.
 *
 * The audit sink stores `args` verbatim — on every model-provider write, and
 * on the credential probe too, since that had to become a mutation to keep the
 * key out of a URL. A secret in a durable, queryable table is worse than one
 * in a request line, so the values go. The field names stay, because "which
 * credentials were set" is the part of the record worth having.
 *
 * `action` is the tRPC path. It selects the rules that only apply to one
 * mutation, such as a run's parameter values.
 */
export function redactAuditArgs({ input, action }: { input: unknown; action?: string }): unknown {
  if (typeof input !== "object" || input === null) return input;

  const record = input as Record<string, unknown>;
  let redacted: Record<string, unknown> | undefined;

  // Built lazily so input carrying no credentials is returned as-is rather
  // than copied — the audit row is then the object the procedure received.
  const replace = (field: string, value: unknown) => {
    redacted ??= { ...record };
    redacted[field] = value;
  };

  for (const field of redactedObjectFieldsFor(action)) {
    const value = redactObjectField(record[field]);
    if (value !== undefined) replace(field, value);
  }

  for (const field of (action ? REDACTED_SCALAR_FIELDS_BY_ACTION[action] : undefined) ?? []) {
    if (record[field] !== undefined) replace(field, "[redacted]");
  }

  if (Array.isArray(record.extraHeaders)) {
    replace("extraHeaders", redactHeaderValues(record.extraHeaders));
  }

  return redacted ?? input;
}
