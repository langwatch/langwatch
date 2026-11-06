import type { DataPrivacyServerConfig } from "@langwatch/data-privacy-contract";
import { ScopedSecrets } from "@langwatch/secrets";
import { describe, expect, it } from "vitest";

import { AwsPiiRedactionModelChannel } from "../../aws.pii-redaction-model.channel.ts";
import { HttpDataPrivacyChannels } from "../http.data-privacy.channels.ts";

const ARN =
  "arn:aws:lambda:eu-central-1:123456789012:function:langwatch-pii-redaction-model-all:live";

function channelsFor(settings: Partial<DataPrivacyServerConfig>) {
  return HttpDataPrivacyChannels.create({
    config: {
      googleDlpDisabled: undefined,
      enforcement: undefined,
      nodeEnvironment: undefined,
      langevalsEndpoint: "http://langevals:5562",
      piiRedactionModelLambdaArn: undefined,
      piiRedactionModelEndpoint: undefined,
      ...settings,
    },
    secrets: new ScopedSecrets(async (_handle, build) => build(undefined)),
  });
}

const probe = { texts: [], entities: [], signal: new AbortController().signal };

describe("HttpDataPrivacyChannels", () => {
  describe("given neither model setting", () => {
    /** @scenario "A deployment that names no model behaves exactly as today" */
    it("composes a model channel that answers not configured", async () => {
      const { piiRedactionModel } = await channelsFor({});

      await expect(piiRedactionModel.detect(probe)).resolves.toEqual({ kind: "not_configured" });
    });
  });

  describe("given the model's Lambda alias", () => {
    /** @scenario "The model's Lambda alias wins over its address" */
    it("composes the Lambda channel, even with an address set too", async () => {
      const { piiRedactionModel } = await channelsFor({
        piiRedactionModelLambdaArn: ARN,
        piiRedactionModelEndpoint: "http://pii-redaction-model:8080",
      });

      expect(piiRedactionModel).toBeInstanceOf(AwsPiiRedactionModelChannel);
    });

    /** @scenario "The model's Lambda alias wins over its address" */
    it("leaves the model unconfigured when the ARN is unusable", async () => {
      const { piiRedactionModel } = await channelsFor({ piiRedactionModelLambdaArn: "not-an-arn" });

      await expect(piiRedactionModel.detect(probe)).resolves.toEqual({ kind: "not_configured" });
    });
  });

  describe("given only the model's address", () => {
    it("composes an HTTP channel that counts as configured", async () => {
      const { piiRedactionModel } = await channelsFor({
        piiRedactionModelEndpoint: "http://pii-redaction-model:8080",
      });

      await expect(piiRedactionModel.detect(probe)).resolves.toEqual({
        kind: "detected",
        results: [],
      });
    });
  });
});
