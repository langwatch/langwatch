import { describe, expect, it } from "vitest";
import { isValidPauseKey, isValidGroupId } from "../validators.ts";

describe("isValidPauseKey", () => {
  describe("when value is valid", () => {
    it("accepts single segment: pipeline", () => {
      expect(isValidPauseKey("ingestion")).toBe(true);
    });

    it("accepts two segments: pipeline/type", () => {
      expect(isValidPauseKey("ingestion/projection")).toBe(true);
    });

    it("accepts three segments: pipeline/type/name", () => {
      expect(isValidPauseKey("ingestion/projection/traceProjection")).toBe(true);
    });

    it("accepts hyphens and underscores", () => {
      expect(isValidPauseKey("my-pipeline/job_type/name-1")).toBe(true);
    });

    it("accepts strings at exactly 200 chars", () => {
      expect(isValidPauseKey("a".repeat(200))).toBe(true);
    });
  });

  describe("when value has malformed slashes", () => {
    it("rejects leading slash", () => {
      expect(isValidPauseKey("/pipeline")).toBe(false);
    });

    it("rejects trailing slash", () => {
      expect(isValidPauseKey("pipeline/")).toBe(false);
    });

    it("rejects consecutive slashes", () => {
      expect(isValidPauseKey("pipeline//type")).toBe(false);
    });

    it("rejects more than 3 segments", () => {
      expect(isValidPauseKey("a/b/c/d")).toBe(false);
    });
  });

  describe("when value is empty or too long", () => {
    it("rejects empty string", () => {
      expect(isValidPauseKey("")).toBe(false);
    });

    it("rejects strings over 200 chars", () => {
      expect(isValidPauseKey("a".repeat(201))).toBe(false);
    });
  });

  describe("when value contains special characters", () => {
    it("rejects spaces, dots, colons", () => {
      expect(isValidPauseKey("pipeline name")).toBe(false);
      expect(isValidPauseKey("pipeline.name")).toBe(false);
      expect(isValidPauseKey("pipeline:name")).toBe(false);
    });
  });

  describe("when value is non-string", () => {
    it("rejects numbers, null, undefined", () => {
      expect(isValidPauseKey(123)).toBe(false);
      expect(isValidPauseKey(null)).toBe(false);
      expect(isValidPauseKey(undefined)).toBe(false);
    });
  });
});

describe("isValidGroupId", () => {
  describe("when value is valid", () => {
    it("accepts normal group IDs", () => {
      expect(isValidGroupId("project_abc123")).toBe(true);
    });

    it("accepts strings at exactly 512 chars", () => {
      expect(isValidGroupId("a".repeat(512))).toBe(true);
    });
  });

  describe("when value is empty or too long", () => {
    it("rejects empty string", () => {
      expect(isValidGroupId("")).toBe(false);
    });

    it("rejects strings over 512 chars", () => {
      expect(isValidGroupId("a".repeat(513))).toBe(false);
    });
  });

  describe("when value is non-string", () => {
    it("rejects numbers and null", () => {
      expect(isValidGroupId(123)).toBe(false);
      expect(isValidGroupId(null)).toBe(false);
    });
  });
});
