import { describe, expect, it } from "vitest";

import { piiRedactionModelTargetOf } from "../pii-redaction-model.rules.ts";

const ARN =
  "arn:aws:lambda:eu-central-1:123456789012:function:langwatch-pii-redaction-model-all:live";

describe("piiRedactionModelTargetOf", () => {
  /** @scenario "The model's Lambda alias wins over its address" */
  it("prefers the Lambda alias and reads its region from the ARN", () => {
    expect(
      piiRedactionModelTargetOf({ lambdaArn: ` ${ARN} `, endpoint: "http://model:8080" }),
    ).toEqual({ kind: "lambda", functionArn: ARN, region: "eu-central-1" });
  });

  it("uses the address, without a trailing slash, when no alias is set", () => {
    expect(piiRedactionModelTargetOf({ lambdaArn: "", endpoint: "http://model:8080/" })).toEqual({
      kind: "http",
      endpoint: "http://model:8080",
    });
  });

  /** @scenario "A deployment that names no model behaves exactly as today" */
  it("names no target when neither is set", () => {
    expect(piiRedactionModelTargetOf({ lambdaArn: void 0, endpoint: "  " })).toEqual({
      kind: "none",
    });
  });

  /** @scenario "The model's Lambda alias wins over its address" */
  it("refuses an ARN that is not a Lambda function ARN, even with an address set", () => {
    const target = piiRedactionModelTargetOf({
      lambdaArn: "langwatch-pii-redaction-model-all",
      endpoint: "http://model:8080",
    });

    expect(target.kind).toBe("invalid");
  });
});
