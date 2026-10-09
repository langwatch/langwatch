import { beforeEach, describe, expect, it } from "vitest";
import { clampCodeBlockTimeoutSeconds } from "../index";

describe("clampCodeBlockTimeoutSeconds", () => {
  beforeEach(() => {
    // Ensure environment variables are set for the module to calculate MAX_SECONDS
    process.env.LANGWATCH_NLP_LAMBDA_CONFIG = JSON.stringify({
      AWS_ACCESS_KEY_ID: "test-key",
      AWS_SECRET_ACCESS_KEY: "test-secret",
      AWS_REGION: "us-east-1",
      role_arn: "arn:aws:iam::123456789012:role/test-role",
      image_uri: "test-image-uri",
      cache_bucket: "test-bucket",
      subnet_ids: ["subnet-123"],
      security_group_ids: ["sg-123"],
    });
  });

  it("returns 600 when rawValue is undefined", () => {
    expect(clampCodeBlockTimeoutSeconds(undefined)).toBe(600);
  });

  it("returns 600 when rawValue is an empty string", () => {
    expect(clampCodeBlockTimeoutSeconds("")).toBe(600);
  });

  it("returns 600 when rawValue is non-numeric", () => {
    expect(clampCodeBlockTimeoutSeconds("abc")).toBe(600);
  });

  it("returns 600 when rawValue is zero", () => {
    expect(clampCodeBlockTimeoutSeconds("0")).toBe(600);
  });

  it("returns 600 when rawValue is negative", () => {
    expect(clampCodeBlockTimeoutSeconds("-1")).toBe(600);
  });

  it("returns 600 when rawValue is a fractional number", () => {
    // This is the key bug fix: fractional values should fall back to default
    expect(clampCodeBlockTimeoutSeconds("1.5")).toBe(600);
  });

  it("returns 600 when rawValue is a large fractional number", () => {
    expect(clampCodeBlockTimeoutSeconds("700.5")).toBe(600);
  });

  it("returns the parsed value when it is a valid positive integer", () => {
    expect(clampCodeBlockTimeoutSeconds("600")).toBe(600);
  });

  it("returns the parsed value when it is a smaller valid integer", () => {
    expect(clampCodeBlockTimeoutSeconds("300")).toBe(300);
  });

  it("returns the parsed value one second below MAX_SECONDS", () => {
    expect(clampCodeBlockTimeoutSeconds("709")).toBe(709);
  });

  it("returns the parsed value at MAX_SECONDS", () => {
    expect(clampCodeBlockTimeoutSeconds("710")).toBe(710);
  });

  it("clamps the first value above MAX_SECONDS to MAX_SECONDS", () => {
    expect(clampCodeBlockTimeoutSeconds("711")).toBe(710);
  });

  it("clamps values above MAX_SECONDS to MAX_SECONDS", () => {
    // MAX_SECONDS is 710: the lower of the Lambda invocation timeout (900)
    // and the engine's stream idle timeout (720), less the 10s safety margin.
    expect(clampCodeBlockTimeoutSeconds("900")).toBe(710);
  });

  it("clamps very large values to MAX_SECONDS", () => {
    expect(clampCodeBlockTimeoutSeconds("100000")).toBe(710);
  });

  it("handles leading/trailing whitespace in numeric strings", () => {
    // Number() parser handles whitespace, so " 600 " should work
    expect(clampCodeBlockTimeoutSeconds(" 600 ")).toBe(600);
  });

  // Bounded by the Lambda invocation timeout alone, everything from 721 to 890
  // came back unchanged — values the chart itself hard-fails, and which no
  // Lambda can honour: NLPGO_ENGINE_STREAM_IDLE_TIMEOUT_SECONDS is not among
  // the variables this module reconciles onto a per-project function, so every
  // one of them runs the engine's own 720s silence budget. A code block that
  // long emits nothing and the stream tears down before it can report.
  describe("the engine's stream idle timeout bounds the ceiling too", () => {
    it("clamps a value inside the old Lambda-only allowance", () => {
      expect(clampCodeBlockTimeoutSeconds("760")).toBe(710);
    });

    it("clamps the stream idle timeout itself", () => {
      expect(clampCodeBlockTimeoutSeconds("720")).toBe(710);
    });

    it("clamps the old Lambda-only ceiling", () => {
      expect(clampCodeBlockTimeoutSeconds("890")).toBe(710);
    });

    it("leaves the default ceiling untouched, which sits below the bound", () => {
      expect(clampCodeBlockTimeoutSeconds("600")).toBe(600);
    });
  });
});
