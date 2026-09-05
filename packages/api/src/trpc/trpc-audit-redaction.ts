/**
 * What the audit trail is allowed to keep of a call's arguments.
 */

/**
 * Fields on a model-provider write whose values are secrets. All three ride the same `modelProvider.update`
 * mutation: `customKeys` holds the API key as typed, `providerConfig` is a passthrough object we do not get to
 * police, and `extraHeaders` is precisely where an `Authorization: Bearer …` is entered.
 */
const CREDENTIAL_OBJECT_FIELDS = ["customKeys", "providerConfig"] as const;

/**
 * Action paths whose input carries values a person typed for one run, keyed by
 * the field that holds them.
 */
const REDACTED_VALUE_FIELDS_BY_ACTION: Record<string, readonly string[]> = {
  "suites.run": ["parameters"],
  "scenarios.run": ["parameters"],
  "httpProxy.execute": ["templateVariables"],
};

/**
 * Action paths whose input holds a credential directly in a field, rather than inside an object.
 * `redactObjectField` deliberately ignores a plain string, so these would otherwise be stored as typed. `value` is
 * an ordinary word other mutations use for harmless things, so the rule is bound to the action.
 */
const REDACTED_SCALAR_FIELDS_BY_ACTION: Record<string, readonly string[]> = {
  "secrets.create": ["value"],
  "secrets.update": ["value"],
  "license.generate": ["privateKey"],
  "license.upload": ["licenseKey"],
};

/**
 * Field names that carry credential material whatever mutation they ride on.
 */
const SENSITIVE_FIELD_NAME =
  /(password|passphrase|privatekey|publickey|secretkey|sharedsecret|clientsecret|signingkey|apikey|accesskey|encryptionkey|licensekey|certificate|secret|token(?!s)|credential|slackwebhook|webhookurl|authorization|bearer)/;

/** Whether a field's name says its value is credential material. */
function isSensitiveFieldName(name: string): boolean {
  return SENSITIVE_FIELD_NAME.test(name.toLowerCase().replace(/[^a-z0-9]/g, ""));
}

/**
 * The depth the name rule walks to. A mutation input is a form, not a
 * document; past this the cost of walking is real and the odds of a secret are
 * not.
 */
const MAX_SCAN_DEPTH = 8;

/**
 * The same value with every sensitively-named field replaced, or undefined
 * when the value holds no such field.
 */
function redactSensitiveNames(value: unknown, depth = 0): unknown {
  if (depth >= MAX_SCAN_DEPTH || typeof value !== "object" || value === null) return undefined;

  if (Array.isArray(value)) {
    let changed = false;
    const next = value.map((entry) => {
      const redacted = redactSensitiveNames(entry, depth + 1);
      if (redacted === undefined) return entry;
      changed = true;
      return redacted;
    });
    return changed ? next : undefined;
  }

  const record = value as Record<string, unknown>;
  let next: Record<string, unknown> | undefined;
  for (const [name, field] of Object.entries(record)) {
    if (isSensitiveFieldName(name)) {
      next ??= { ...record };
      next[name] = redactObjectField(field) ?? "[redacted]";
      continue;
    }
    const redacted = redactSensitiveNames(field, depth + 1);
    if (redacted !== undefined) {
      next ??= { ...record };
      next[name] = redacted;
    }
  }
  return next;
}

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
 */
function redactObjectField(value: unknown): unknown {
  if (typeof value !== "object" || value === null) return undefined;
  return Array.isArray(value)
    ? value.map(() => "[redacted]")
    : redactValues(value as Record<string, unknown>);
}

/**
 * The redacted form of an `extraHeaders` list.
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
 */
export function redactAuditArgs({ input, action }: { input: unknown; action?: string }): unknown {
  if (typeof input !== "object" || input === null) return input;

  const record = input as Record<string, unknown>;
  // The standing name rule runs first and at every depth; the action rules
  // below then cover the fields whose names say nothing.
  let redacted = redactSensitiveNames(record) as Record<string, unknown> | undefined;
  const source = redacted ?? record;

  // Built lazily so input carrying no credentials is returned as-is rather
  // than copied — the audit row is then the object the procedure received.
  const replace = (field: string, value: unknown) => {
    redacted ??= { ...source };
    redacted[field] = value;
  };

  for (const field of redactedObjectFieldsFor(action)) {
    const value = redactObjectField(source[field]);
    if (value !== undefined) replace(field, value);
  }

  for (const field of (action ? REDACTED_SCALAR_FIELDS_BY_ACTION[action] : undefined) ?? []) {
    if (source[field] !== undefined) replace(field, "[redacted]");
  }

  if (Array.isArray(source.extraHeaders)) {
    replace("extraHeaders", redactHeaderValues(source.extraHeaders));
  }

  return redacted ?? input;
}
