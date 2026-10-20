import { InvalidActionParamsError } from "@langwatch/automation-contract";
import { HandledError } from "@langwatch/handled-error";

/** The actions whose stored settings are parsed at settlement, and how the refusal names them. */
const STORED_ACTION_LABELS = {
  SEND_EMAIL: "email",
  SEND_WEBHOOK: "webhook",
} as const;

/**
 * The automation's stored action settings no longer satisfy its action, so no
 * redelivery can send it: the author re-saves the automation to fix it.
 */
export function storedActionParamsRefusal({
  triggerName,
  action,
}: {
  triggerName: string;
  action: keyof typeof STORED_ACTION_LABELS;
}): InvalidActionParamsError {
  return new InvalidActionParamsError(
    `The automation "${triggerName}" has ${STORED_ACTION_LABELS[action]} settings that are no longer valid. ` +
      "Open the automation and save its settings again.",
  );
}

/**
 * A customer-fault handled refusal: the customer fixes it in the automation's
 * saved configuration. Whether it is retried is the queue's call
 * (`refusesRetry`), asked first, so a rate-limited one still retries.
 */
export function isCustomerConfigurationRefusal(error: unknown): error is HandledError {
  return HandledError.isHandled(error) && error.fault === "customer";
}
