import {
  CLI_LOGIN_KEY_NAME_PREFIX,
  DOCS_SESSION_API_KEY_NAME,
  type ApiKey,
} from "@langwatch/api-key-contract";
import type { DocsPlaygroundPolicy } from "@langwatch/organization-contract";
import { Temporal, fromDate, toDate, type Instant } from "@langwatch/time";

const DATE_FIELDS = new Set([
  "expiresAt",
  "revokedAt",
  "lastUsedAt",
  "createdAt",
  "updatedAt",
  "docsSessionSince",
]);

/** JSON with the key's dates restored; anything unreadable is a miss. */
export function parseHeld({ raw }: { raw: string }): unknown {
  try {
    return JSON.parse(raw, (field, value: unknown) =>
      DATE_FIELDS.has(field) && typeof value === "string"
        ? toDate(Temporal.Instant.from(value))
        : value,
    );
  } catch {
    return undefined;
  }
}

/** A key a CLI login minted is a CLI token to the credential census; any other is an API key. */
export function keyCredentialTypeOf({ key }: { key: { name: string } }): "cli_token" | "api_key" {
  return key.name.startsWith(CLI_LOGIN_KEY_NAME_PREFIX) ? "cli_token" : "api_key";
}

/** A docs playground session key (ADR-185): system-managed, under the docs session name. */
export function isDocsSessionKey({
  key,
}: {
  key: Pick<ApiKey, "name" | "isSystemManaged">;
}): boolean {
  return key.isSystemManaged === true && key.name === DOCS_SESSION_API_KEY_NAME;
}

/**
 * Whether a key governed by a docs session key minted at `since` may authenticate: only while
 * the playground is on, and only when it was minted after the last time it was turned off.
 */
export function isDocsSessionAllowed({
  since,
  policy,
}: {
  since: Instant;
  policy: DocsPlaygroundPolicy;
}): boolean {
  if (!policy.docsPlaygroundSessionsEnabled) return false;
  const cutoff = policy.docsPlaygroundSessionsDisabledAt;
  return cutoff === null || Temporal.Instant.compare(since, fromDate(cutoff)) > 0;
}

/** Concurrent reads of one token in this process share one promise, dropped once it settles. */
export function shared<T>({
  pending,
  key,
  read,
}: {
  pending: Map<string, Promise<T>>;
  key: string;
  read: () => Promise<T>;
}): Promise<T> {
  const inFlight = pending.get(key);
  if (inFlight) return inFlight;

  const started = read().finally(() => pending.delete(key));
  pending.set(key, started);

  return started;
}

/** A stored key without its secret's hash: what the auth path hands on. */
export function publicApiKey<Row extends { hashedSecret: unknown }>({
  row,
}: {
  row: Row;
}): Omit<Row, "hashedSecret"> {
  const { hashedSecret: _hashedSecret, ...key } = row;

  return key;
}
