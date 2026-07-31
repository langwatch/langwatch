import { describe, expect, it } from "vitest";
import { SecurityError, validateTenantId } from "./tenancy";

describe("validateTenantId", () => {
  describe("given a context carrying a real tenant", () => {
    it("permits the operation", () => {
      expect(() =>
        validateTenantId({ tenantId: "project-1" }, "readTraces"),
      ).not.toThrow();
    });
  });

  describe("given no context at all", () => {
    it("refuses, naming the operation", () => {
      expect(() => validateTenantId(undefined, "readTraces")).toThrow(
        SecurityError,
      );
      expect(() => validateTenantId(undefined, "readTraces")).toThrow(
        /readTraces requires a context with tenantId/,
      );
    });
  });

  describe("given a context whose tenant is absent or blank", () => {
    it.each([
      ["missing", {}],
      ["empty", { tenantId: "" }],
      ["whitespace", { tenantId: "   " }],
    ])("refuses a %s tenant, so it cannot reach a query", (_label, context) => {
      expect(() => validateTenantId(context, "writeSpans")).toThrow(
        SecurityError,
      );
    });
  });

  describe("given a refusal", () => {
    it("carries the operation and the offending tenant for the log line", () => {
      try {
        validateTenantId({ tenantId: "  " }, "writeSpans");
        expect.unreachable("should have refused");
      } catch (error) {
        const refusal = error as SecurityError;
        expect(refusal.operation).toBe("writeSpans");
        expect(refusal.context.operation).toBe("writeSpans");
        expect(refusal.message).toContain("[SECURITY]");
      }
    });
  });
});
