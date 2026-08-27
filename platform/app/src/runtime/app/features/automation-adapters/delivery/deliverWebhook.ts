import {
  WebhookDeliveryAdapter,
  type WebhookDeliveryRecorder,
  type WebhookDeliveryRequest,
  type WebhookDeliveryTransport,
  type WebhookSendResult,
} from "@langwatch/automation-server";
import {
  assertWebhookDelivered,
  sendWebhook,
  type WebhookSendResult as AppWebhookSendResult,
} from "~/server/webhooks/sendWebhook";

interface AppWebhookDeliveryRequest extends WebhookDeliveryRequest {
  /** Test and graph-alert callers can substitute a transport. */
  send?: typeof sendWebhook;
}

function transportFor(send: typeof sendWebhook): WebhookDeliveryTransport {
  return {
    send: async (input): Promise<WebhookSendResult> => {
      const result: AppWebhookSendResult = await send(input);
      return result;
    },
    assertDelivered: ({ result, triggerName }) => assertWebhookDelivered({ result, triggerName }),
  };
}

const defaultDelivery = WebhookDeliveryAdapter.create(transportFor(sendWebhook));

/** Compatibility composition adapter; delivery bookkeeping lives in the feature server. */
export function deliverWebhook({
  send = sendWebhook,
  ...request
}: AppWebhookDeliveryRequest): Promise<WebhookSendResult> {
  if (send === sendWebhook) return defaultDelivery.deliver(request);
  return WebhookDeliveryAdapter.create(transportFor(send)).deliver(request);
}

export type { WebhookDeliveryRecorder };
