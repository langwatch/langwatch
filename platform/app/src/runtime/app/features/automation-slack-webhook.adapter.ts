import { isSlackWebhookUrl } from "@langwatch/automation-contract";
import { DispatchError } from "@langwatch/eventing";

export function assertSlackWebhookUrl(url: string, triggerName: string): void {
  if (isSlackWebhookUrl(url)) {
    return;
  }

  throw new DispatchError({
    message: `Refusing to dispatch Slack webhook for trigger "${triggerName}": URL is not a genuine https://hooks.slack.com/services/ endpoint`,
    retryable: false,
  });
}
