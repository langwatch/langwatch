import { describe, expect, it } from "vitest";

import {
  batchCharactersOf,
  isBatchTooLongForModel,
  PII_REDACTION_MODEL_MAX_BATCH_CHARACTERS,
  piiRedactionModelTargetOf,
} from "../pii-redaction-model.rules.ts";

const ARN =
  "arn:aws:lambda:eu-central-1:123456789012:function:langwatch-pii-redaction-model-all:live";

describe("piiRedactionModelTargetOf", () => {
  /** @scenario "One setting names the model by Lambda ARN or by address" */
  it("reads an ARN as the model's Lambda and takes the region from it", () => {
    expect(piiRedactionModelTargetOf(` ${ARN} `)).toEqual({
      kind: "lambda",
      functionArn: ARN,
      region: "eu-central-1",
    });
  });

  /** @scenario "One setting names the model by Lambda ARN or by address" */
  it("reads anything else as the HTTP address, without a trailing slash", () => {
    expect(piiRedactionModelTargetOf("http://model:8080/")).toEqual({
      kind: "http",
      endpoint: "http://model:8080",
    });
  });

  /** @scenario "A deployment that names no model behaves exactly as today" */
  it("names no target when the setting is unset or blank", () => {
    expect(piiRedactionModelTargetOf(void 0)).toEqual({ kind: "none" });
    expect(piiRedactionModelTargetOf("  ")).toEqual({ kind: "none" });
  });

  /** @scenario "One setting names the model by Lambda ARN or by address" */
  it("refuses an ARN that is not a Lambda function ARN", () => {
    expect(piiRedactionModelTargetOf("arn:aws:s3:::langwatch-pii-redaction-model-all").kind).toBe(
      "invalid",
    );
  });
});
describe("isBatchTooLongForModel", () => {
  /** @scenario "A long batch skips the model and goes to Presidio" */
  it("keeps a batch of exactly 8,000 characters on the model", () => {
    expect(PII_REDACTION_MODEL_MAX_BATCH_CHARACTERS).toBe(8_000);
    expect(isBatchTooLongForModel(["a".repeat(8_000)])).toBe(false);
  });

  /** @scenario "A long batch skips the model and goes to Presidio" */
  it("sends one text over 8,000 characters to Presidio", () => {
    expect(isBatchTooLongForModel(["a".repeat(8_001)])).toBe(true);
  });

  /** @scenario "A long batch skips the model and goes to Presidio" */
  it("counts the whole batch, so many short texts add up", () => {
    const texts = Array.from({ length: 5 }, () => "a".repeat(2_000));

    expect(batchCharactersOf(texts)).toBe(10_000);
    expect(isBatchTooLongForModel(texts)).toBe(true);
  });
});
