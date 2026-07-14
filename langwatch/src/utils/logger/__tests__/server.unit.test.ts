import { describe, it, expect } from "vitest";
import { consoleIgnoreFields } from "../server";

describe("consoleIgnoreFields", () => {
  describe("when the observability stack is up", () => {
    it("drops the business-context fields but keeps trace/span for correlation", () => {
      const ignored = consoleIgnoreFields(true).split(",");

      expect(ignored).toContain("projectId");
      expect(ignored).toContain("userId");
      expect(ignored).toContain("organizationId");
      // trace/span are the whole point of the compact line — they must stay.
      expect(ignored).not.toContain("traceId");
      expect(ignored).not.toContain("spanId");
    });
  });

  describe("when the observability stack is down", () => {
    it("keeps every context field on the console (only pid/hostname hidden)", () => {
      expect(consoleIgnoreFields(false)).toBe("pid,hostname");
    });
  });
});
