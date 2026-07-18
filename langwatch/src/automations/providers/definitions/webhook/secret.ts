import { decrypt, encrypt } from "~/utils/encryption";
import {
  WEBHOOK_HEADER_VALUE_KEPT,
  type WebhookActionParams,
} from "./shared";

/**
 * Server-only handling of webhook header secrets (ADR-040 §3). Header values
 * (Authorization, API keys) are AES-256-GCM encrypted at rest (shared
 * `encrypt`/`decrypt`, CREDENTIALS_SECRET) and NEVER leave the server in
 * either direction — the same discipline as the Slack bot token:
 *  - persist: encrypt the whole header record; a value sent as
 *    `WEBHOOK_HEADER_VALUE_KEPT` resolves to the stored value for that name.
 *  - read: echo header NAMES with the kept sentinel as every value.
 *  - deliver: decrypt just before the SSRF-fenced send.
 */

/** The shape webhook actionParams take AT REST: the plaintext `headers`
 *  record is replaced by one ciphertext blob. */
export type WebhookStoredActionParams = Omit<WebhookActionParams, "headers"> & {
  headersEncrypted?: string;
  /** Legacy plain record — only ever present on rows saved before encryption
   *  landed; superseded by `headersEncrypted` on the next save. */
  headers?: Record<string, string>;
};

/** Decrypt the stored header record for a dispatch or test fire. Empty when
 *  none are configured. Falls back to a legacy plaintext record if present. */
export function decryptWebhookHeaders(
  params: Pick<WebhookStoredActionParams, "headersEncrypted" | "headers">,
): Record<string, string> {
  if (params.headersEncrypted) {
    return JSON.parse(decrypt(params.headersEncrypted)) as Record<
      string,
      string
    >;
  }
  return params.headers ?? {};
}

/**
 * Prepare webhook actionParams for persistence: resolve kept sentinels against
 * the saved row, then encrypt the full record. A kept value whose name has no
 * stored counterpart is dropped (renaming a header requires re-typing its
 * value — the stored value is keyed by the old name).
 */
export function persistWebhookActionParams({
  incoming,
  existing,
}: {
  incoming: WebhookActionParams;
  existing?: WebhookStoredActionParams | null;
}): WebhookStoredActionParams {
  const hasKept = Object.values(incoming.headers).includes(
    WEBHOOK_HEADER_VALUE_KEPT,
  );
  if (hasKept && existing?.url !== incoming.url) {
    throw new Error(
      "Re-enter webhook header values after changing the destination URL.",
    );
  }
  const saved = existing ? decryptWebhookHeaders(existing) : {};
  const resolved: Record<string, string> = {};
  for (const [name, value] of Object.entries(incoming.headers)) {
    if (value === WEBHOOK_HEADER_VALUE_KEPT) {
      if (saved[name] !== undefined) resolved[name] = saved[name];
      continue;
    }
    resolved[name] = value;
  }
  const { headers: _drop, ...rest } = incoming;
  return {
    ...rest,
    ...(Object.keys(resolved).length > 0
      ? { headersEncrypted: encrypt(JSON.stringify(resolved)) }
      : {}),
  };
}

/** Replace stored header secrets with the kept sentinel before the row is
 *  sent to the browser — the client only needs the names. */
export function redactWebhookActionParams(
  params: WebhookStoredActionParams,
): WebhookActionParams {
  const names = Object.keys(decryptWebhookHeaders(params));
  const { headersEncrypted: _drop, headers: _dropLegacy, ...rest } = params;
  return {
    ...rest,
    headers: Object.fromEntries(
      names.map((name) => [name, WEBHOOK_HEADER_VALUE_KEPT]),
    ),
  } as WebhookActionParams;
}
