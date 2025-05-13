import { sendSlackWebhook } from "../server/triggers/sendSlackWebhook";

export default async function execute(webhook: string) {
  await sendSlackWebhook({
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
          timestamps: {
            started_at: 123,
            inserted_at: 123,
            updated_at: 123,
          },
          spans: [],
        },
      },
    ],
    triggerName: "Low Faithfulness",
    projectSlug: "inbox-narrator",
    triggerType: "WARNING",
    triggerMessage: "",
  });
}
