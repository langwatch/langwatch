import { describe, expect, it } from "vitest";
import { isValidPauseKey, isValidGroupId } from "../validators.ts";

describe("isValidPauseKey", () => {
  it("accepts alphanumeric with slashes: pipeline/type/name", () => {
    expect(isValidPauseKey("ingestion/projection/traceProjection")).toBe(true);
  });

  it("accepts hyphens and underscores", () => {
    expect(isValidPauseKey("my-pipeline/job_type/name-1")).toBe(true);
  });

  it("rejects empty string", () => {
    expect(isValidPauseKey("")).toBe(false);
  });

  it("rejects strings over 200 chars", () => {
    expect(isValidPauseKey("a".repeat(201))).toBe(false);
  });

  it("accepts strings at exactly 200 chars", () => {
    expect(isValidPauseKey("a".repeat(200))).toBe(true);
  });

  it("rejects special characters: spaces, dots, colons", () => {
    expect(isValidPauseKey("pipeline name")).toBe(false);
    expect(isValidPauseKey("pipeline.name")).toBe(false);
    expect(isValidPauseKey("pipeline:name")).toBe(false);
  });

  it("rejects non-string values", () => {
    expect(isValidPauseKey(123)).toBe(false);
    expect(isValidPauseKey(null)).toBe(false);
    expect(isValidPauseKey(undefined)).toBe(false);
  });
});

describe("isValidGroupId", () => {
  it("accepts normal group IDs", () => {
    expect(isValidGroupId("project_abc123")).toBe(true);
  });

  it("rejects empty string", () => {
    expect(isValidGroupId("")).toBe(false);
  });

  it("rejects strings over 512 chars", () => {
    expect(isValidGroupId("a".repeat(513))).toBe(false);
  });

  it("accepts strings at exactly 512 chars", () => {
    expect(isValidGroupId("a".repeat(512))).toBe(true);
  });

  it("rejects non-string values", () => {
    expect(isValidGroupId(123)).toBe(false);
    expect(isValidGroupId(null)).toBe(false);
  });
});
