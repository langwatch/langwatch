import { classOf, SECRET_KEYS } from "./keys.ts";

/** What a redacted secret reads as. One spelling everywhere, so it greps. */
export const REDACTED = "[redacted]";

function redactCompositeValue(value: string): string {
  const trimmed = value.trim();
  if (trimmed === "") return trimmed;

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return REDACTED;
  }

  parsed.username = "";
  parsed.password = "";
  parsed.search = "";
  parsed.hash = "";

  return parsed.toString();
}

export function redactForLog({ key, value }: { key: string; value: unknown }): unknown {
  if (typeof value !== "string") return value;

  switch (classOf({ key })) {
    case "secret":
      return REDACTED;
    case "composite":
      return redactCompositeValue(value);
    default:
      return value;
  }
}

/**
 * The pino `redact` paths for the secret class: the bare key as a top-level
 * field, and the same name one level down, which is where a config object
 * logged by a boot line puts it.
 */
export function secretLogRedactPaths(): readonly string[] {
  return SECRET_KEYS.flatMap((key) => [key, `*.${key}`]);
}
