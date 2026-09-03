export abstract class WebhookSecretPort {
  abstract encrypt(value: string): string;
  abstract decrypt(value: string): string;
}
