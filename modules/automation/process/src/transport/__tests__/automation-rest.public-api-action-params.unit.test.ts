import {
  annotationQueueProvider,
  automationRestAnnotationQueueActionParamsSchema,
  automationRestDatasetActionParamsSchema,
  automationRestEmailActionParamsSchema,
  automationRestSlackActionParamsSchema,
  automationRestWebhookActionParamsSchema,
  datasetProvider,
  emailProvider,
  slackProvider,
  webhookProvider,
} from "@langwatch/automation-contract";
import { describe, expect, it } from "vitest";

import { deliveryFieldNames } from "../../rules/trigger-redaction.rules.ts";

/** Fields a channel reads that the wire never states: the server stamps them. */
const SERVER_STAMPED = new Set(["createdByUserId"]);

const PAIRS = [
  [emailProvider, automationRestEmailActionParamsSchema],
  [slackProvider, automationRestSlackActionParamsSchema],
  [webhookProvider, automationRestWebhookActionParamsSchema],
  [datasetProvider, automationRestDatasetActionParamsSchema],
  [annotationQueueProvider, automationRestAnnotationQueueActionParamsSchema],
] as const;

describe("Feature: the API expresses the automations the dashboard expresses", () => {
  describe("when the API's delivery schemas are read", () => {
    /** @scenario "Each channel's delivery configuration is published by name" */
    it.each(PAIRS.map(([provider, wire]) => [provider.action, provider, wire] as const))(
      "names the fields %s actually reads",
      (_action, provider, wire) => {
        const reads = [...deliveryFieldNames(provider.actionParamsSchema)].filter(
          (field) => !SERVER_STAMPED.has(field),
        );
        expect(Object.keys(wire.shape).toSorted()).toEqual(reads.toSorted());
      },
    );

    it("publishes one for every channel this server offers", () => {
      expect(PAIRS.map(([provider]) => provider.action).toSorted()).toEqual([
        "ADD_TO_ANNOTATION_QUEUE",
        "ADD_TO_DATASET",
        "SEND_EMAIL",
        "SEND_SLACK_MESSAGE",
        "SEND_WEBHOOK",
      ]);
    });
  });
});
