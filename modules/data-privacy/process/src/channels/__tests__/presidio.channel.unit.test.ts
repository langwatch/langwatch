import { describe, expect, it } from "vitest";

import { AwsPiiRedactionModelChannel } from "../aws.pii-redaction-model.channel.ts";
import { HttpPresidioChannel } from "../http/http.presidio.channel.ts";
import { canSplit } from "../presidio.channel.ts";

const ARN = "arn:aws:lambda:eu-central-1:123456789012:function:langwatch-pii-redaction-model:live";
const batch = { texts: ["hi Ana"], entities: ["PERSON"], signal: new AbortController().signal };

describe("canSplit", () => {
  /** @scenario "Splitting is on only where the model is a Lambda function and the organization's split flag is on" */
  it("is true for the model's Lambda channel and false for an HTTP channel", () => {
    const lambda = AwsPiiRedactionModelChannel.create({
      lambda: { send: async () => ({}) },
      functionArn: ARN,
    });
    const http = HttpPresidioChannel.create({ endpoint: "http://pii-redaction-model:8080" });

    expect(canSplit(lambda)).toBe(true);
    expect(canSplit(http)).toBe(false);
    // @ts-expect-error An HTTP channel takes no split call: a pod answers one request at a time.
    void (() => http.detect(batch, { context: "split" }));
  });
});
