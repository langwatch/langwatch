import type { DataPrivacyServerConfig } from "@langwatch/data-privacy-contract";
import { describe, expect, it } from "vitest";

import { MemoryDataPrivacyChannels } from "../memory.data-privacy.channels.ts";

const ARN =
  "arn:aws:lambda:eu-central-1:123456789012:function:langwatch-pii-redaction-model-split:live";

function splitChannelFor(piiRedactionModelSplitEndpoint: string | undefined) {
  const config: DataPrivacyServerConfig = {
    googleDlpDisabled: undefined,
    enforcement: undefined,
    nodeEnvironment: undefined,
    isSaas: true,
    langevalsEndpoint: undefined,
    piiRedactionModelEndpoint: undefined,
    piiRedactionModelSplitEndpoint,
  };
  return MemoryDataPrivacyChannels.create({ config }).piiRedactionModelSplit;
}

describe("MemoryDataPrivacyChannels, the split model", () => {
  /** @scenario "A split model named by anything but a Lambda function ARN splits nothing" */
  it.each(["http://pii-redaction-model:8080", "arn:aws:s3:::bucket", ""])(
    "is unconfigured for %j, as the live channel is",
    async (endpoint) => {
      const outcome = await splitChannelFor(endpoint).detect({
        texts: ["a"],
        entities: [],
        signal: new AbortController().signal,
      });

      expect(outcome.kind).toBe("not_configured");
    },
  );

  it("is configured for a Lambda function ARN", async () => {
    const outcome = await splitChannelFor(ARN).detect({
      texts: [],
      entities: [],
      signal: new AbortController().signal,
    });

    expect(outcome.kind).toBe("detected");
  });
});
