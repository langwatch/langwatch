import type { WebhookDispatchResult } from "../../app/webhook.app.ts";
import type { WebhookDispatchChannel, WebhookDispatchInput } from "../webhook-dispatch.channel.ts";

/** The dispatch channel's memory twin: keeps every batch it was handed and answers success. */
export class MemoryWebhookDispatchChannel implements WebhookDispatchChannel {
  readonly #sent: WebhookDispatchInput[] = [];

  static create(): MemoryWebhookDispatchChannel {
    return new MemoryWebhookDispatchChannel();
  }

  private constructor() {}

  get sent(): readonly WebhookDispatchInput[] {
    return this.#sent;
  }

  dispatch = (input: WebhookDispatchInput): Promise<WebhookDispatchResult> => {
    this.#sent.push(input);
    return Promise.resolve({
      verdict: "success",
      status: input.destination.kind === "sqs" ? null : 200,
      body: "",
      dispatchId: input.batchId,
    });
  };
}
