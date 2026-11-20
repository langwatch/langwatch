import { ATTR_KEYS } from "../attributeKeys.ts";

type AttributeSource = ReadonlyMap<string, unknown> | Readonly<Record<string, unknown>>;

/** A session key as the coding-agent aggregate reads it: a string, or a finite number as text. */
export function asSessionKey(raw: unknown): string | null {
  if (typeof raw === "number" && Number.isFinite(raw)) return String(raw);
  return typeof raw === "string" && raw.length > 0 ? raw : null;
}

/** A launcher's `langwatch.session.id`: off the record first, else off its resource. */
export function readDeclaredSessionKey({
  attributes,
  resourceAttributes,
}: {
  attributes: AttributeSource;
  resourceAttributes: Readonly<Record<string, unknown>> | null | undefined;
}): string | null {
  const key = ATTR_KEYS.LANGWATCH_SESSION_ID;
  const own =
    attributes instanceof Map ? attributes.get(key) : (attributes as Record<string, unknown>)[key];
  return asSessionKey(own) ?? asSessionKey(resourceAttributes?.[key]);
}
