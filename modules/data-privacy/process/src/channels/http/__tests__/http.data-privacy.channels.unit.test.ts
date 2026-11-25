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
      isSaas: true,
      langevalsEndpoint: "http://langevals:5562",
      piiRedactionModelEndpoint: undefined,
      piiRedactionModelSplitEndpoint: undefined,
      ...settings,
    },
    secrets: new ScopedSecrets(async (_handle, build) => build(undefined)),
  });
}

const probe = { texts: [], entities: [], signal: new AbortController().signal };

describe("HttpDataPrivacyChannels", () => {
  describe("given no model setting", () => {
    /** @scenario "A deployment that names no model behaves exactly as today" */
    it("composes a model channel that answers not configured", async () => {
      const { piiRedactionModel } = await channelsFor({});

      await expect(piiRedactionModel.detect(probe)).resolves.toEqual({ kind: "not_configured" });
    });
  });

  describe("given the model's Lambda alias ARN", () => {
    /** @scenario "One setting names the model by Lambda ARN or by address" */
    it("composes the Lambda channel", async () => {
      const { piiRedactionModel } = await channelsFor({ piiRedactionModelEndpoint: ARN });

      expect(piiRedactionModel).toBeInstanceOf(AwsPiiRedactionModelChannel);
    });

    /** @scenario "One setting names the model by Lambda ARN or by address" */
    it("leaves the model unconfigured when the ARN is not a Lambda function ARN", async () => {
      const { piiRedactionModel } = await channelsFor({
        piiRedactionModelEndpoint: "arn:aws:s3:::not-a-function",
      });

      await expect(piiRedactionModel.detect(probe)).resolves.toEqual({ kind: "not_configured" });
    });
  });

  describe("given the model's address", () => {
    /** @scenario "One setting names the model by Lambda ARN or by address" */
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

describe("HttpDataPrivacyChannels, the split model (ADR-207)", () => {
  /** @scenario "A split model named by anything but a Lambda function ARN splits nothing" */
  it("composes a split channel that answers not configured for an address or a bad ARN", async () => {
    for (const setting of [undefined, "http://pii-redaction-model:8080", "arn:aws:s3:::bucket"]) {
      const { piiRedactionModelSplit } = await channelsFor({
        piiRedactionModelSplitEndpoint: setting,
      });

      await expect(piiRedactionModelSplit.detect(probe)).resolves.toEqual({
        kind: "not_configured",
      });
    }
  });

  /** @scenario "A split model named by anything but a Lambda function ARN splits nothing" */
  it("composes the Lambda channel for a Lambda function ARN", async () => {
    const { piiRedactionModelSplit } = await channelsFor({ piiRedactionModelSplitEndpoint: ARN });

    expect(piiRedactionModelSplit).toBeInstanceOf(AwsPiiRedactionModelChannel);
  });
});
