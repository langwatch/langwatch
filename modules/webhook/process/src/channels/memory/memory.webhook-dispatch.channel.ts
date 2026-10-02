import type { WebhookSendResult } from "../../rules/webhook-delivery-classification.rules.ts";
import type { WebhookSendInput } from "../../services/webhook-egress.service.ts";
import type { WebhookDispatchChannel } from "../webhook-dispatch.channel.ts";

/** The dispatch channel's memory twin: keeps every send it was handed and answers 200. */
export class MemoryWebhookDispatchChannel implements WebhookDispatchChannel {
  readonly #sent: WebhookSendInput[] = [];

  static create(): MemoryWebhookDispatchChannel {
    return new MemoryWebhookDispatchChannel();
  }

  private constructor() {}

  get sent(): readonly WebhookSendInput[] {
    return this.#sent;
  }

  send(input: WebhookSendInput): Promise<WebhookSendResult> {
    this.#sent.push(input);
    return Promise.resolve({
      status: 200,
      body: "",
      eventId: input.eventId ?? `memory-dispatch-${this.#sent.length}`,
    });
  }
}
