import { Task } from "@langwatch/task";
import { SlackWebhookClientAdapter } from "#adapters/slack-webhook.client.adapter";
import { SlackWebhookDeliveryAdapter } from "#adapters/slack-webhook.delivery.adapter";

/** Manual smoke test of the automation delivery path: one sample alert to the webhook URL given as the first argument. */
export class SlackAlertTask extends Task {
  readonly name = "slack-alert";
  readonly description = "Sends one fixed sample alert to a Slack incoming-webhook URL.";

  static create(): SlackAlertTask {
    return new SlackAlertTask();
  }

  async run({ args }: { args: readonly string[]; signal: AbortSignal }): Promise<void> {
    const webhook = args[0];
    if (!webhook) {
      throw new Error("Name the destination Slack webhook URL as the task's first argument.");
    }
    // The deployment the smoke-test message links back to; unset in a
    // deployment with no public base host, which is fine for a manual send.
    const baseHost = args[1] ?? process.env.BASE_HOST ?? "";

    const slackClient = SlackWebhookClientAdapter.create();
    const adapter = SlackWebhookDeliveryAdapter.create((url) => ({
      send: (payload) => slackClient.send({ webhook: url, payload }),
    }));

    await adapter.deliver({
      triggerWebhook: webhook,
      triggerData: [
        {
          traceId: "89e29a13-94e9-49dd-b57d-a299f1f15788",
          input: "what's your refund policy?",
          output: "we don't have a refund policy",
          fullTrace: {
            trace_id: "89e29a13-94e9-49dd-b57d-a299f1f15788",
            project_id: "inbox-narrator",
            metadata: {},
            timestamps: { started_at: 123, inserted_at: 123, updated_at: 123 },
            spans: [],
          },
        },
      ],
      triggerName: "Low Faithfulness",
      projectSlug: "inbox-narrator",
      triggerType: "WARNING",
      triggerMessage: "",
      baseHost,
    });
  }
}
