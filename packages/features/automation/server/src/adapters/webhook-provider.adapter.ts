import {
  WEBHOOK_HEADER_VALUE_KEPT,
  InvalidActionParamsError,
  type WebhookActionParams,
  webhookMethodSchema,
} from "@langwatch/automation-contract";
import { z } from "zod";
import {
  AutomationWebhookProviderPort,
  type AutomationWebhookStoredParams,
} from "../ports/automation-provider.port";

export const WEBHOOK_PREVIOUS_SECRET_TTL_MS = 24 * 60 * 60 * 1000;

export interface AutomationWebhookSecretCrypto {
  encrypt(value: string): string;
  decrypt(value: string): string;
}

const webhookStoredActionParamsSchema = z
  .object({
    url: z.string().url(),
    method: webhookMethodSchema.default("POST"),
    bodyTemplate: z.string().nullable().default(null),
    headersEncrypted: z.string().optional(),
    headers: z.record(z.string(), z.string()).optional(),
    signingSecretEncrypted: z.string().optional(),
    previousSigningSecretEncrypted: z.string().optional(),
    previousSigningSecretExpiresAt: z.number().int().optional(),
  })
  .strict();

export type WebhookStoredActionParams = AutomationWebhookStoredParams;

function decryptWebhookSigningSecrets(
  params: {
    signingSecretEncrypted?: string;
    previousSigningSecretEncrypted?: string;
    previousSigningSecretExpiresAt?: number;
  },
  crypto: AutomationWebhookSecretCrypto,
  now: Date = new Date(),
): string[] {
  if (!params.signingSecretEncrypted) return [];
  const previousIsValid =
    params.previousSigningSecretEncrypted !== undefined &&
    params.previousSigningSecretExpiresAt !== undefined &&
    params.previousSigningSecretExpiresAt > now.getTime();
  return [
    crypto.decrypt(params.signingSecretEncrypted),
    ...(previousIsValid && params.previousSigningSecretEncrypted
      ? [crypto.decrypt(params.previousSigningSecretEncrypted)]
      : []),
  ];
}

function decryptWebhookHeaders(
  params: { headersEncrypted?: string; headers?: Record<string, string> },
  crypto: AutomationWebhookSecretCrypto,
): Record<string, string> {
  if (params.headersEncrypted) {
    return JSON.parse(crypto.decrypt(params.headersEncrypted)) as Record<string, string>;
  }
  return params.headers ?? {};
}

function persistWebhookActionParams({
  incoming,
  existing,
  crypto,
}: {
  incoming: WebhookActionParams;
  existing?: WebhookStoredActionParams | null;
  crypto: AutomationWebhookSecretCrypto;
}): WebhookStoredActionParams {
  const hasKept = Object.values(incoming.headers).includes(WEBHOOK_HEADER_VALUE_KEPT);
  if (hasKept && existing?.url !== incoming.url) {
    throw new InvalidActionParamsError(
      "Re-enter webhook header values after changing the destination URL.",
      "url",
    );
  }
  const saved = existing ? decryptWebhookHeaders(existing, crypto) : {};
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
      ? { headersEncrypted: crypto.encrypt(JSON.stringify(resolved)) }
      : {}),
    ...persistSigningSecret({ incoming, existing, crypto }),
  };
}

function keepRotationWindow(
  existing?: WebhookStoredActionParams | null,
): Partial<WebhookStoredActionParams> {
  if (!existing?.previousSigningSecretEncrypted) return {};
  return {
    previousSigningSecretEncrypted: existing.previousSigningSecretEncrypted,
    previousSigningSecretExpiresAt: existing.previousSigningSecretExpiresAt,
  };
}

function keepStoredSigningSecret(
  existing?: WebhookStoredActionParams | null,
): Partial<WebhookStoredActionParams> {
  if (!existing?.signingSecretEncrypted) return {};
  return {
    signingSecretEncrypted: existing.signingSecretEncrypted,
    ...keepRotationWindow(existing),
  };
}

function persistSigningSecret({
  incoming,
  existing,
  crypto,
}: {
  incoming: WebhookActionParams;
  existing?: WebhookStoredActionParams | null;
  crypto: AutomationWebhookSecretCrypto;
}): Partial<WebhookStoredActionParams> {
  const submitted = incoming.signingSecret;
  if (submitted === WEBHOOK_HEADER_VALUE_KEPT) {
    return keepStoredSigningSecret(existing);
  }
  if (!submitted) return {};
  const current = existing?.signingSecretEncrypted
    ? crypto.decrypt(existing.signingSecretEncrypted)
    : null;
  if (current === submitted) return keepStoredSigningSecret(existing);
  if (!current) return { signingSecretEncrypted: crypto.encrypt(submitted) };
  return {
    signingSecretEncrypted: crypto.encrypt(submitted),
    previousSigningSecretEncrypted: existing?.signingSecretEncrypted,
    previousSigningSecretExpiresAt: Date.now() + WEBHOOK_PREVIOUS_SECRET_TTL_MS,
  };
}

function redactWebhookActionParams(
  params: WebhookStoredActionParams,
  crypto: AutomationWebhookSecretCrypto,
): WebhookActionParams {
  const names = Object.keys(decryptWebhookHeaders(params, crypto));
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

/** Owns webhook secret persistence and redaction. Crypto is process
 * configuration and is bound once when the adapter is composed. */
export class WebhookProviderAdapter extends AutomationWebhookProviderPort {
  private constructor(private readonly crypto: AutomationWebhookSecretCrypto) {
    super();
  }

  static create(crypto: AutomationWebhookSecretCrypto): WebhookProviderAdapter {
    return new WebhookProviderAdapter(crypto);
  }

  parseStored(value: unknown): WebhookStoredActionParams {
    return webhookStoredActionParamsSchema.parse(value);
  }

  decryptSigningSecrets(
    params: {
      signingSecretEncrypted?: string;
      previousSigningSecretEncrypted?: string;
      previousSigningSecretExpiresAt?: number;
    },
    now?: Date,
  ): string[] {
    return decryptWebhookSigningSecrets(params, this.crypto, now);
  }

  decryptHeaders(params: {
    headersEncrypted?: string;
    headers?: Record<string, string>;
  }): Record<string, string> {
    return decryptWebhookHeaders(params, this.crypto);
  }

  persist(input: {
    incoming: WebhookActionParams;
    existing?: WebhookStoredActionParams | null;
  }): WebhookStoredActionParams {
    return persistWebhookActionParams({ ...input, crypto: this.crypto });
  }

  redact(params: WebhookStoredActionParams): WebhookActionParams {
    return redactWebhookActionParams(params, this.crypto);
  }
}
