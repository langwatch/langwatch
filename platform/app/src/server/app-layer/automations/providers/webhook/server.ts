import {
  WEBHOOK_HEADER_VALUE_KEPT,
  InvalidActionParamsError,
  type WebhookActionParams,
} from "@langwatch/automation-contract";
import { TriggerAction } from "~/generated/prisma/client";
import { WEBHOOK_PREVIOUS_SECRET_TTL_MS } from "~/server/webhooks/signature";
import { decrypt, encrypt } from "~/utils/encryption";
import type { PersistActionParamsArgs, ServerDef } from "../types";

/**
 * Server half of the webhook provider (ADR-040 §3). Header values
 * (Authorization, API keys) are AES-256-GCM encrypted at rest (shared
 * `encrypt`/`decrypt`, CREDENTIALS_SECRET) and NEVER leave the server in
 * either direction — the same discipline as the Slack bot token:
 *  - persist: encrypt the whole header record; a value sent as
 *    `WEBHOOK_HEADER_VALUE_KEPT` resolves to the stored value for that name.
 *  - read: echo header NAMES with the kept sentinel as every value.
 *  - deliver: decrypt just before the SSRF-fenced send.
 */

/** The shape webhook actionParams take AT REST: the plaintext `headers`
 *  record and the signing secret are replaced by ciphertext blobs. */
export type WebhookStoredActionParams = Omit<
  WebhookActionParams,
  "headers" | "signingSecret"
> & {
  headersEncrypted?: string;
  /** Legacy plain record — only ever present on rows saved before encryption
   *  landed; superseded by `headersEncrypted` on the next save. */
  headers?: Record<string, string>;
  signingSecretEncrypted?: string;
  /** The secret this one replaced, still signing until it expires, so a
   *  receiver can swap on its own schedule instead of dropping deliveries
   *  during the swap. */
  previousSigningSecretEncrypted?: string;
  /** Epoch ms. actionParams is JSON, so a Date would not survive the round
   *  trip. */
  previousSigningSecretExpiresAt?: number;
};

/**
 * The secrets a dispatch signs with, newest first: the current one, plus the
 * one it replaced while that is still inside its window. Empty when the
 * trigger has no secret, which is the default and means unsigned.
 */
export function decryptWebhookSigningSecrets(
  params: Pick<
    WebhookStoredActionParams,
    | "signingSecretEncrypted"
    | "previousSigningSecretEncrypted"
    | "previousSigningSecretExpiresAt"
  >,
  now: Date = new Date(),
): string[] {
  if (!params.signingSecretEncrypted) return [];
  const previousIsValid =
    params.previousSigningSecretEncrypted !== undefined &&
    params.previousSigningSecretExpiresAt !== undefined &&
    params.previousSigningSecretExpiresAt > now.getTime();
  return [
    decrypt(params.signingSecretEncrypted),
    ...(previousIsValid
      ? [decrypt(params.previousSigningSecretEncrypted as string)]
      : []),
  ];
}

/** Decrypt the stored header record for a dispatch or test fire. Empty when
 *  none are configured. Falls back to a legacy plaintext record if present. */
export function decryptWebhookHeaders(
  params: Pick<WebhookStoredActionParams, "headersEncrypted" | "headers">,
): Record<string, string> {
  if (params.headersEncrypted) {
    return JSON.parse(decrypt(params.headersEncrypted)) as Record<string, string>;
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
  const hasKept = Object.values(incoming.headers).includes(WEBHOOK_HEADER_VALUE_KEPT);
  if (hasKept && existing?.url !== incoming.url) {
    throw new InvalidActionParamsError(
      "Re-enter webhook header values after changing the destination URL.",
      "url",
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
  const { headers: _drop, signingSecret: _dropSecret, ...rest } = incoming;
  return {
    ...rest,
    ...(Object.keys(resolved).length > 0
      ? { headersEncrypted: encrypt(JSON.stringify(resolved)) }
      : {}),
    ...persistSigningSecret({ incoming, existing }),
  };
}

/** The stored rotation window, carried forward untouched. */
function keepRotationWindow(
  existing?: WebhookStoredActionParams | null,
): Partial<WebhookStoredActionParams> {
  if (!existing?.previousSigningSecretEncrypted) return {};
  return {
    previousSigningSecretEncrypted: existing.previousSigningSecretEncrypted,
    previousSigningSecretExpiresAt: existing.previousSigningSecretExpiresAt,
  };
}

/** Everything about the stored secret, left exactly as it is. */
function keepStoredSigningSecret(
  existing?: WebhookStoredActionParams | null,
): Partial<WebhookStoredActionParams> {
  if (!existing?.signingSecretEncrypted) return {};
  return {
    signingSecretEncrypted: existing.signingSecretEncrypted,
    ...keepRotationWindow(existing),
  };
}

/**
 * The signing-secret half of a save.
 *
 * The kept sentinel leaves the stored secret and any rotation window exactly
 * as they are. An empty value clears signing, dropping the previous secret
 * with it: an author turning signing off does not want the old secret to keep
 * signing anything. A new value rotates, keeping the one it replaced valid for
 * the same window the endpoints platform uses, so the author can paste the new
 * secret here and deploy it to their receiver afterwards rather than in the
 * same instant.
 */
function persistSigningSecret({
  incoming,
  existing,
}: {
  incoming: WebhookActionParams;
  existing?: WebhookStoredActionParams | null;
}): Partial<WebhookStoredActionParams> {
  const submitted = incoming.signingSecret;
  if (submitted === WEBHOOK_HEADER_VALUE_KEPT) {
    return keepStoredSigningSecret(existing);
  }
  if (!submitted) return {};
  const current = existing?.signingSecretEncrypted
    ? decrypt(existing.signingSecretEncrypted)
    : null;
  if (current === submitted) return keepStoredSigningSecret(existing);
  if (!current) return { signingSecretEncrypted: encrypt(submitted) };
  return {
    signingSecretEncrypted: encrypt(submitted),
    previousSigningSecretEncrypted: existing?.signingSecretEncrypted,
    previousSigningSecretExpiresAt: Date.now() + WEBHOOK_PREVIOUS_SECRET_TTL_MS,
  };
}

/** Replace stored header secrets with the kept sentinel before the row is
 *  sent to the browser — the client only needs the names. */
export function redactWebhookActionParams(
  params: WebhookStoredActionParams,
): WebhookActionParams {
  const names = Object.keys(decryptWebhookHeaders(params));
  const {
    headersEncrypted: _drop,
    headers: _dropLegacy,
    signingSecretEncrypted,
    previousSigningSecretEncrypted: _dropPrevious,
    previousSigningSecretExpiresAt: _dropPreviousExpiry,
    ...rest
  } = params;
  return {
    ...rest,
    headers: Object.fromEntries(names.map((name) => [name, WEBHOOK_HEADER_VALUE_KEPT])),
    signingSecret: signingSecretEncrypted ? WEBHOOK_HEADER_VALUE_KEPT : null,
  } as WebhookActionParams;
}

const def: ServerDef = {
  action: TriggerAction.SEND_WEBHOOK,
  persistActionParams: async ({ incoming, loadExisting }: PersistActionParamsArgs) => {
    const params = incoming as WebhookActionParams;
    // The stored row is needed to resolve a kept header value, and equally to
    // resolve a kept signing secret or to rotate the one it replaces.
    const needsExisting =
      Object.values(params.headers ?? {}).includes(WEBHOOK_HEADER_VALUE_KEPT) ||
      (params.signingSecret ?? null) !== null;
    const existing = needsExisting
      ? ((await loadExisting()) as WebhookStoredActionParams | undefined)
      : undefined;
    return persistWebhookActionParams({ incoming: params, existing });
  },
  redactActionParams: (params) =>
    redactWebhookActionParams((params ?? {}) as WebhookStoredActionParams),
};

export default def;
