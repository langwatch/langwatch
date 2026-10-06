import {
  DEFAULT_WEBHOOK_CONTENT_TYPE,
  InvalidActionParamsError,
  type WebhookActionParams,
} from "@langwatch/automation-contract";
import { nowInstant, type Instant } from "@langwatch/time";
import {
  WEBHOOK_HEADER_VALUE_KEPT,
  WEBHOOK_PREVIOUS_SECRET_TTL_MS,
  webhookMethodSchema,
} from "@langwatch/webhook-contract";
import { z } from "zod";

import type { TriggerSecretSeal } from "../repositories/trigger.repository.ts";

export type AutomationWebhookStoredParams = {
  url: string;
  method: WebhookActionParams["method"];
  bodyTemplate: string | null;
  contentType?: string;
  headersEncrypted?: string;
  headers?: Record<string, string>;
  signingSecretEncrypted?: string;
  previousSigningSecretEncrypted?: string;
  previousSigningSecretExpiresAt?: number;
};

export abstract class AutomationWebhookProvider {
  abstract parseStored(value: unknown): AutomationWebhookStoredParams;

  abstract decryptHeaders(params: {
    headersEncrypted?: string;
    headers?: Record<string, string>;
  }): Record<string, string>;

  abstract decryptSigningSecrets(
    params: {
      signingSecretEncrypted?: string;
      previousSigningSecretEncrypted?: string;
      previousSigningSecretExpiresAt?: number;
    },
    now?: Instant,
  ): string[];

  abstract persist(input: {
    incoming: WebhookActionParams;
    existing?: AutomationWebhookStoredParams | null;
  }): AutomationWebhookStoredParams;

  abstract redact(params: AutomationWebhookStoredParams): WebhookActionParams;
}

const webhookStoredActionParamsSchema = z
  .object({
    url: z.string().url(),
    method: webhookMethodSchema.default("POST"),
    bodyTemplate: z.string().nullable().default(null),
    contentType: z.string().default(DEFAULT_WEBHOOK_CONTENT_TYPE),
    headersEncrypted: z.string().optional(),
    headers: z.record(z.string(), z.string()).optional(),
    signingSecretEncrypted: z.string().optional(),
    previousSigningSecretEncrypted: z.string().optional(),
    previousSigningSecretExpiresAt: z.number().int().optional(),
  })
  .strict();

export type WebhookStoredActionParams = AutomationWebhookStoredParams;

/** Owns webhook secret persistence and redaction; the trigger repository
 * seals and opens each stored secret (ARCHITECTURE.md §3.2). */
export class AutomationWebhookSecretsService extends AutomationWebhookProvider {
  private constructor(private readonly triggers: TriggerSecretSeal) {
    super();
  }

  static create(triggers: TriggerSecretSeal): AutomationWebhookSecretsService {
    return new AutomationWebhookSecretsService(triggers);
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
    now?: Instant,
  ): string[] {
    return AutomationWebhookSecretsService.decryptSigningSecrets(params, this.triggers, now);
  }

  decryptHeaders(params: {
    headersEncrypted?: string;
    headers?: Record<string, string>;
  }): Record<string, string> {
    return AutomationWebhookSecretsService.decryptHeaders(params, this.triggers);
  }

  persist(input: {
    incoming: WebhookActionParams;
    existing?: WebhookStoredActionParams | null;
  }): WebhookStoredActionParams {
    return AutomationWebhookSecretsService.persistActionParams({
      ...input,
      triggers: this.triggers,
    });
  }

  redact(params: WebhookStoredActionParams): WebhookActionParams {
    return AutomationWebhookSecretsService.redactActionParams(params, this.triggers);
  }

  private static decryptSigningSecrets(
    params: {
      signingSecretEncrypted?: string;
      previousSigningSecretEncrypted?: string;
      previousSigningSecretExpiresAt?: number;
    },
    triggers: TriggerSecretSeal,
    now: Instant = nowInstant(),
  ): string[] {
    if (!params.signingSecretEncrypted) return [];
    const previousIsValid =
      params.previousSigningSecretEncrypted !== undefined &&
      params.previousSigningSecretExpiresAt !== undefined &&
      params.previousSigningSecretExpiresAt > now.epochMilliseconds;
    return [
      triggers.openSecret({ sealed: params.signingSecretEncrypted }),
      ...(previousIsValid && params.previousSigningSecretEncrypted
        ? [triggers.openSecret({ sealed: params.previousSigningSecretEncrypted })]
        : []),
    ];
  }

  private static decryptHeaders(
    params: { headersEncrypted?: string; headers?: Record<string, string> },
    triggers: TriggerSecretSeal,
  ): Record<string, string> {
    if (params.headersEncrypted) {
      return JSON.parse(triggers.openSecret({ sealed: params.headersEncrypted })) as Record<
        string,
        string
      >;
    }
    return params.headers ?? {};
  }

  private static persistActionParams({
    incoming,
    existing,
    triggers,
  }: {
    incoming: WebhookActionParams;
    existing?: WebhookStoredActionParams | null;
    triggers: TriggerSecretSeal;
  }): WebhookStoredActionParams {
    AutomationWebhookSecretsService.assertKeptSecretsStayWithTheirDestination({
      incoming,
      existing,
    });
    const saved = existing
      ? AutomationWebhookSecretsService.decryptHeaders(existing, triggers)
      : {};
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
        ? { headersEncrypted: triggers.sealSecret({ plain: JSON.stringify(resolved) }) }
        : {}),
      ...AutomationWebhookSecretsService.persistSigningSecret({ incoming, existing, triggers }),
    };
  }

  /** A saved header value or signing secret authenticates against the URL it was
   *  issued for, so a changed URL has to arrive with fresh values. */
  private static assertKeptSecretsStayWithTheirDestination({
    incoming,
    existing,
  }: {
    incoming: WebhookActionParams;
    existing?: WebhookStoredActionParams | null;
  }): void {
    if (existing?.url === incoming.url) return;
    if (Object.values(incoming.headers).includes(WEBHOOK_HEADER_VALUE_KEPT)) {
      throw new InvalidActionParamsError(
        "Re-enter webhook header values after changing the destination URL.",
        "url",
      );
    }
    if (incoming.signingSecret === WEBHOOK_HEADER_VALUE_KEPT) {
      throw new InvalidActionParamsError(
        "Re-enter the signing secret after changing the destination URL.",
        "signingSecret",
      );
    }
  }

  private static keepRotationWindow(
    existing?: WebhookStoredActionParams | null,
  ): Partial<WebhookStoredActionParams> {
    if (!existing?.previousSigningSecretEncrypted) return {};
    return {
      previousSigningSecretEncrypted: existing.previousSigningSecretEncrypted,
      previousSigningSecretExpiresAt: existing.previousSigningSecretExpiresAt,
    };
  }

  private static keepStoredSigningSecret(
    existing?: WebhookStoredActionParams | null,
  ): Partial<WebhookStoredActionParams> {
    if (!existing?.signingSecretEncrypted) return {};
    return {
      signingSecretEncrypted: existing.signingSecretEncrypted,
      ...AutomationWebhookSecretsService.keepRotationWindow(existing),
    };
  }

  private static persistSigningSecret({
    incoming,
    existing,
    triggers,
  }: {
    incoming: WebhookActionParams;
    existing?: WebhookStoredActionParams | null;
    triggers: TriggerSecretSeal;
  }): Partial<WebhookStoredActionParams> {
    const submitted = incoming.signingSecret;
    if (submitted === WEBHOOK_HEADER_VALUE_KEPT) {
      return AutomationWebhookSecretsService.keepStoredSigningSecret(existing);
    }
    if (!submitted) return {};
    const current = existing?.signingSecretEncrypted
      ? triggers.openSecret({ sealed: existing.signingSecretEncrypted })
      : null;
    if (current === submitted)
      return AutomationWebhookSecretsService.keepStoredSigningSecret(existing);
    if (!current) return { signingSecretEncrypted: triggers.sealSecret({ plain: submitted }) };
    return {
      signingSecretEncrypted: triggers.sealSecret({ plain: submitted }),
      previousSigningSecretEncrypted: existing?.signingSecretEncrypted,
      previousSigningSecretExpiresAt:
        nowInstant().epochMilliseconds + WEBHOOK_PREVIOUS_SECRET_TTL_MS,
    };
  }

  private static redactActionParams(
    params: WebhookStoredActionParams,
    triggers: TriggerSecretSeal,
  ): WebhookActionParams {
    const names = Object.keys(AutomationWebhookSecretsService.decryptHeaders(params, triggers));
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
}
