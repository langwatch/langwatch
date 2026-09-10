import type { WebhookActionParams } from "@langwatch/automation-contract";
import type { Instant } from "@langwatch/time";

export type AutomationWebhookStoredParams = {
  url: string;
  method: WebhookActionParams["method"];
  bodyTemplate: string | null;
  headersEncrypted?: string;
  headers?: Record<string, string>;
  signingSecretEncrypted?: string;
  previousSigningSecretEncrypted?: string;
  previousSigningSecretExpiresAt?: number;
};

export abstract class AutomationSlackProvider {
  abstract tryDecrypt(params: { slackBotToken?: string }): string | null;
}

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
