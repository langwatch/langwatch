import { DispatchError } from "@langwatch/eventing";

import { AutomationNotificationDelivery } from "../channels/automation-notification-delivery.channel.ts";

/** Main's refusal for a process with no public origin: a digest would link back to nowhere. */
export class AutomationNotificationDeliveryUnavailableService extends AutomationNotificationDelivery {
  static create(): AutomationNotificationDeliveryUnavailableService {
    return new AutomationNotificationDeliveryUnavailableService();
  }

  private constructor() {
    super();
  }

  sendLegacyEmail(): Promise<void> {
    return refuseDelivery();
  }

  sendEmail(): Promise<void> {
    return refuseDelivery();
  }

  sendSlackWebhook(): Promise<void> {
    return refuseDelivery();
  }

  sendLegacySlackWebhook(): Promise<void> {
    return refuseDelivery();
  }

  sendSlackBot(): Promise<void> {
    return refuseDelivery();
  }

  sendWebhook(): Promise<never> {
    return refuseDelivery();
  }
}

function refuseDelivery(): Promise<never> {
  return Promise.reject(
    new DispatchError({
      message:
        "This process composes no outbound automation delivery: it named no BASE_HOST, so a digest would carry links back to nowhere. Set BASE_HOST to send settled notifications from here.",
      retryable: false,
    }),
  );
}
