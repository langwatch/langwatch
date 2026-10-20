import { InvalidActionParamsError, type TriggerSummary } from "@langwatch/automation-contract";
import { HandledError } from "@langwatch/handled-error";

const ACTION_LABELS: Partial<Record<TriggerSummary["action"], string>> = {
  SEND_EMAIL: "email",
  SEND_SLACK_MESSAGE: "Slack",
  SEND_WEBHOOK: "webhook",
};

/**
 * The automation's stored action settings no longer satisfy its action, so no
 * redelivery can send it: the author re-saves the automation to fix it.
 */
export function storedActionParamsRefusal(trigger: TriggerSummary): InvalidActionParamsError {
  const label = ACTION_LABELS[trigger.action] ?? "action";
  return new InvalidActionParamsError(
    `The automation "${trigger.name}" has ${label} settings that are no longer valid. ` +
      "Open the automation and save its settings again.",
  );
}

/** A refusal the customer fixes in the automation's saved configuration. */
export function isCustomerConfigurationRefusal(
  error: unknown,
): error is InstanceType<typeof HandledError> {
  return HandledError.isHandled(error) && error.fault === "customer" && !error.retryable;
}
