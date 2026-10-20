import { InvalidActionParamsError, type TriggerSummary } from "@langwatch/automation-contract";
import { isDispatchError } from "@langwatch/eventing";

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
export type CustomerConfigurationRefusal = { code: string; fault: "customer"; message: string };

/**
 * A handled refusal with customer fault that does not ask for a retry. Read by
 * shape, not by class, so a refusal that crossed a module boundary still counts.
 */
export function isCustomerConfigurationRefusal(
  error: unknown,
): error is CustomerConfigurationRefusal {
  if (typeof error !== "object" || error === null) return false;
  return (
    Reflect.get(error, "fault") === "customer" &&
    Reflect.get(error, "retryable") !== true &&
    typeof Reflect.get(error, "code") === "string"
  );
}

/**
 * Whether a settlement failure is worth another attempt. A dispatch error says
 * so itself; a customer configuration refusal never is; anything unclassified is.
 */
export function isRetryableSettlementFailure(error: unknown): boolean {
  if (isDispatchError(error)) return error.retryable;
  return !isCustomerConfigurationRefusal(error);
}
