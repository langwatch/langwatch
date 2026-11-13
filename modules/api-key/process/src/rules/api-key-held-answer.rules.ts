import {
  CLI_LOGIN_KEY_NAME_PREFIX,
  DOCS_SESSION_API_KEY_NAME,
  type ApiKey,
} from "@langwatch/api-key-contract";
import { Temporal, toDate } from "@langwatch/time";

const DATE_FIELDS = new Set(["expiresAt", "revokedAt", "lastUsedAt", "createdAt", "updatedAt"]);

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
