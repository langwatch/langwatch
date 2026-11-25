import {
  annotationQueueProvider,
  datasetProvider,
  emailProvider,
  slackProvider,
  webhookProvider,
} from "@langwatch/automation-contract";
import { describe, expect, it } from "vitest";

import { deliveryFieldNames } from "../trigger-redaction.rules.ts";

const providers = [
  emailProvider,
  slackProvider,
  webhookProvider,
  datasetProvider,
  annotationQueueProvider,
];

describe("given every delivery channel this server offers", () => {
  describe("when the fields it owns are read off its schema", () => {
    it.each(providers.map((provider) => [provider.action, provider] as const))(
      "names them for %s",
      (_action, provider) => {
        // A schema that is not an object shape claims nothing by name, and the
        // delivery/rule split would then carry every field across as the rule.
        expect(deliveryFieldNames(provider.actionParamsSchema).size).toBeGreaterThan(0);
      },
    );
  });
});
