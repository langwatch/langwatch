import type { SingleEvaluationResult } from "@langwatch/evaluator-contract";
import { describe, expect, it } from "vitest";
import { EvaluatorNativeService } from "../src/services/evaluator-native.service";

const native = EvaluatorNativeService.create();

const passed: SingleEvaluationResult = {
  status: "processed",
  score: 0,
  passed: true,
};

describe("native evaluator", () => {
  it("detects provider keys in nested mapped content", async () => {
    const result = await native.execute({
      evaluatorType: "langwatch/api_keys_and_secrets_detection",
      data: {
        headers: {
          authorization: "sk-proj-aB3dEf_gHi-jKlMnOpQrStUvWx0123456789xY",
        },
      },
    });

    expect(result.status).toBe("processed");
    if (result.status !== "processed") {
      return;
    }
    expect(result.passed).toBe(false);
    expect(result.score).toBe(1);
    expect(result.details).toContain("provider_api_key");
  });

  it("keeps clean content passing", async () => {
    await expect(
      native.execute({
        evaluatorType: "langwatch/api_keys_and_secrets_detection",
        data: { input: "the user asked about the weather" },
      }),
    ).resolves.toEqual(passed);
  });

  it("adds redacted secret markers back to a passing result", () => {
    expect(
      native.augment({
        evaluatorType: "langwatch/api_keys_and_secrets_detection",
        mappedData: { input: "authorization: [SECRET]" },
        settings: void 0,
        droppedCategories: [],
        result: passed,
      }),
    ).toMatchObject({ status: "processed", score: 1, passed: false });
  });

  it("honours enabled PII entities and ignores disabled ones", () => {
    const result = native.augment({
      evaluatorType: "presidio/pii_detection",
      mappedData: { input: "[EMAIL_ADDRESS] [IP_ADDRESS]" },
      settings: { entities: { email_address: true, ip_address: false } },
      droppedCategories: [],
      result: passed,
    });

    expect(result).toMatchObject({ status: "processed", score: 1, passed: false });
  });

  it("fails an empty mapped value when its content was dropped", () => {
    expect(
      native.augment({
        evaluatorType: "presidio/pii_detection",
        mappedData: { input: "" },
        settings: void 0,
        droppedCategories: ["input"],
        result: { status: "skipped", details: "empty" },
      }),
    ).toMatchObject({ status: "processed", score: 1, passed: false });
  });

  it("does not rewrite operational errors", () => {
    const error: SingleEvaluationResult = {
      status: "error",
      error_type: "X",
      details: "boom",
      traceback: [],
    };

    expect(
      native.augment({
        evaluatorType: "langwatch/api_keys_and_secrets_detection",
        mappedData: { input: "[SECRET]" },
        settings: void 0,
        droppedCategories: [],
        result: error,
      }),
    ).toBe(error);
  });
});
