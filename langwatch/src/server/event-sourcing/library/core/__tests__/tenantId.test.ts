import { describe, it, expect } from "vitest";
import { createTenantId, type TenantId } from "../tenantId";

describe("TenantId", () => {
  describe("createTenantId", () => {
    describe("when value is a valid non-empty string", () => {
      it("creates a TenantId", () => {
        const tenantId = createTenantId("test-tenant");

        expect(tenantId).toBe("test-tenant");
        expect(typeof tenantId).toBe("string");
      });

      it("creates a TenantId with alphanumeric characters", () => {
        const tenantId = createTenantId("tenant123");

        expect(tenantId).toBe("tenant123");
      });

      it("creates a TenantId with special characters", () => {
        const tenantId = createTenantId("tenant_123-abc");

        expect(tenantId).toBe("tenant_123-abc");
      });

      it("creates a TenantId with leading/trailing whitespace (preserved)", () => {
        const tenantId = createTenantId("  tenant123  ");

        expect(tenantId).toBe("  tenant123  ");
        // Note: The function validates that trim() is not empty, but preserves the original value
      });
    });

    describe("when value is an empty string", () => {
      it("throws an error", () => {
        expect(() => createTenantId("")).toThrow(
          "[SECURITY] TenantId must be a non-empty string for tenant isolation",
        );
      });
    });

    describe("when value is only whitespace", () => {
      it("throws an error for spaces", () => {
        expect(() => createTenantId("   ")).toThrow(
          "[SECURITY] TenantId must be a non-empty string for tenant isolation",
        );
      });

      it("throws an error for tabs", () => {
        expect(() => createTenantId("\t\t")).toThrow(
          "[SECURITY] TenantId must be a non-empty string for tenant isolation",
        );
      });

      it("throws an error for newlines", () => {
        expect(() => createTenantId("\n\n")).toThrow(
          "[SECURITY] TenantId must be a non-empty string for tenant isolation",
        );
      });

      it("throws an error for mixed whitespace", () => {
        expect(() => createTenantId(" \t\n ")).toThrow(
          "[SECURITY] TenantId must be a non-empty string for tenant isolation",
        );
      });
    });

    describe("when value is not a string", () => {
      it("throws an error for null", () => {
        expect(() => createTenantId(null as unknown as string)).toThrow(
          "[SECURITY] TenantId must be a non-empty string for tenant isolation",
        );
      });

      it("throws an error for undefined", () => {
        expect(() => createTenantId(undefined as unknown as string)).toThrow(
          "[SECURITY] TenantId must be a non-empty string for tenant isolation",
        );
      });

      it("throws an error for number", () => {
        expect(() => createTenantId(123 as unknown as string)).toThrow(
          "[SECURITY] TenantId must be a non-empty string for tenant isolation",
        );
      });

      it("throws an error for object", () => {
        expect(() => createTenantId({} as unknown as string)).toThrow(
          "[SECURITY] TenantId must be a non-empty string for tenant isolation",
        );
      });

      it("throws an error for array", () => {
        expect(() => createTenantId([] as unknown as string)).toThrow(
          "[SECURITY] TenantId must be a non-empty string for tenant isolation",
        );
      });
    });

    describe("type safety", () => {
      it("returns a TenantId branded type", () => {
        const tenantId = createTenantId("test-tenant");

        // TypeScript compile-time check - this should compile
        const _typedTenantId: TenantId = tenantId;
        expect(_typedTenantId).toBe(tenantId);
      });

      it("prevents mixing TenantId with regular strings at compile time", () => {
        const tenantId = createTenantId("test-tenant");
        const regularString = "regular-string";

        // These should work
        expect(tenantId).toBe("test-tenant");
        expect(regularString).toBe("regular-string");

        // TypeScript should prevent this at compile time:
        // const _invalid: TenantId = regularString; // This should cause a type error
        // But at runtime, they're both strings, so we can't test this directly
      });
    });
  });
});
