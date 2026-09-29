import { isSensitiveAttributeKey } from "@langwatch/redaction";

const REDACTED = "[redacted]";
const MAX_DEPTH = 20;

/** Credential-bearing keys the shared sensitive-key rule does not name. */
const CREDENTIAL_KEYS = new Set([
  "botToken",
  "slackBotToken",
  "webhook",
  "slackWebhook",
]);

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

/** Header names stay readable; every value is a potential credential. */
function redactHeaderValues(headers: unknown): unknown {
  if (!isPlainObject(headers)) return REDACTED;
  return Object.fromEntries(
    Object.keys(headers).map((name) => [name, REDACTED]),
  );
}

/**
 * A copy of a logged tRPC value with secrets masked: header values, signing
 * secrets, bot tokens and Slack webhook URLs. Anything that is not a plain
 * object or array is returned as it is.
 */
export function redactLoggedValue(value: unknown, depth = 0): unknown {
  if (depth > MAX_DEPTH) return value;
  if (Array.isArray(value)) {
    return value.map((item) => redactLoggedValue(item, depth + 1));
  }
  if (!isPlainObject(value)) return value;
  return Object.fromEntries(
    Object.entries(value).map(([key, entry]) => {
      if (key === "headers") return [key, redactHeaderValues(entry)];
      if (entry !== null && entry !== undefined && isCredentialKey(key)) {
        return [key, REDACTED];
      }
      return [key, redactLoggedValue(entry, depth + 1)];
    }),
  );
}

function isCredentialKey(key: string): boolean {
  return CREDENTIAL_KEYS.has(key) || isSensitiveAttributeKey(key);
}

/** The console the tRPC logger link writes through, with values masked. */
export const redactingConsole = {
  log: (...args: unknown[]) =>
    console.log(...args.map((arg) => redactLoggedValue(arg))),
  error: (...args: unknown[]) =>
    console.error(...args.map((arg) => redactLoggedValue(arg))),
};
