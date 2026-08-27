import type { WebhookActionParams } from "@langwatch/automation-contract";

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

export abstract class AutomationSlackProviderPort {
  abstract tryDecrypt(params: { slackBotToken?: string }): string | null;
}

export abstract class AutomationWebhookProviderPort {
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
    now?: Date,
  ): string[];

  abstract persist(input: {
    incoming: WebhookActionParams;
    existing?: AutomationWebhookStoredParams | null;
  }): AutomationWebhookStoredParams;

  abstract redact(params: AutomationWebhookStoredParams): WebhookActionParams;
}
