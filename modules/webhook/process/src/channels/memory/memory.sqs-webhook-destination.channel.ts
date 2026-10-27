import type {
  SqsWebhookDestinationMessage,
  SqsWebhookSender,
} from "../webhook-destination.channel.ts";

/**
 * The memory SQS sender records queue messages exactly as the destination
 * adapter handed them over. It has no credential cache, so invalidation is a
 * deliberate no-op.
 */
export class MemorySqsWebhookDestinationChannel implements SqsWebhookSender {
  readonly #messages: SqsWebhookDestinationMessage[] = [];

  private constructor() {}

  static create(): MemorySqsWebhookDestinationChannel {
    return new MemorySqsWebhookDestinationChannel();
  }

  async send(message: SqsWebhookDestinationMessage): Promise<string> {
    this.#messages.push(copyMessage(message));

    return `memory-sqs-${this.#messages.length}`;
  }

  invalidate(_queueUrl: string): void {}

  messages(): readonly SqsWebhookDestinationMessage[] {
    return this.#messages.map(copyMessage);
  }
}

function copyMessage(message: SqsWebhookDestinationMessage): SqsWebhookDestinationMessage {
  return {
    config: { ...message.config },
    body: message.body,
    attributes: Object.fromEntries(
      Object.entries(message.attributes).map(([name, value]) => [name, { ...value }]),
    ),
  };
}
