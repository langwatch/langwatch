import { HandledError } from "@langwatch/handled-error";

/** The actions whose stored settings are parsed at settlement, and how the refusal names them. */
const STORED_ACTION_LABELS = {
  SEND_EMAIL: "email",
  SEND_WEBHOOK: "webhook",
} as const;

/**
 * Why the automation's stored action settings are refused: they no longer
 * satisfy its action, so the author re-saves the automation to fix it.
 */
export function storedActionParamsMessage({
  triggerName,
  action,
}: {
  triggerName: string;
  action: keyof typeof STORED_ACTION_LABELS;
}): string {
  return (
    `The automation "${triggerName}" has ${STORED_ACTION_LABELS[action]} settings that are no longer valid. ` +
    "Open the automation and save its settings again."
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
