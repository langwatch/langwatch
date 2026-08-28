import { describe, it, expect, beforeEach } from "vitest";
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

  it("should return 600 when rawValue is undefined", () => {
    expect(clampCodeBlockTimeoutSeconds(undefined)).toBe(600);
  });

  it("should return 600 when rawValue is an empty string", () => {
    expect(clampCodeBlockTimeoutSeconds("")).toBe(600);
  });

  it("should return 600 when rawValue is non-numeric", () => {
    expect(clampCodeBlockTimeoutSeconds("abc")).toBe(600);
  });

  it("should return 600 when rawValue is zero", () => {
    expect(clampCodeBlockTimeoutSeconds("0")).toBe(600);
  });

  it("should return 600 when rawValue is negative", () => {
    expect(clampCodeBlockTimeoutSeconds("-1")).toBe(600);
  });

  it("should return 600 when rawValue is a fractional number", () => {
    // This is the key bug fix: fractional values should fall back to default
    expect(clampCodeBlockTimeoutSeconds("1.5")).toBe(600);
  });

  it("should return 600 when rawValue is a large fractional number", () => {
    expect(clampCodeBlockTimeoutSeconds("700.5")).toBe(600);
  });

  it("should return the parsed value when it is a valid positive integer", () => {
    expect(clampCodeBlockTimeoutSeconds("600")).toBe(600);
  });

  it("should return the parsed value when it is a smaller valid integer", () => {
    expect(clampCodeBlockTimeoutSeconds("300")).toBe(300);
  });

  it("should clamp values above MAX_SECONDS to MAX_SECONDS", () => {
    // MAX_SECONDS is 890 (900 - 10 safety margin)
    expect(clampCodeBlockTimeoutSeconds("900")).toBe(890);
  });

  it("should clamp very large values to MAX_SECONDS", () => {
    expect(clampCodeBlockTimeoutSeconds("100000")).toBe(890);
  });

  it("should handle leading/trailing whitespace in numeric strings", () => {
    // Number() parser handles whitespace, so " 600 " should work
    expect(clampCodeBlockTimeoutSeconds(" 600 ")).toBe(600);
  });
});
