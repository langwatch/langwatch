import { describe, expect, it } from "vitest";

import { createTenantId } from "../tenantId";

describe("createTenantId", () => {
  describe("when value is a valid non-empty string", () => {
    it("returns TenantId for non-empty string", () => {
      const result = createTenantId("tenant-123");
      expect(result).toBe("tenant-123");
    });

    it("returns TenantId for string with content", () => {
      const result = createTenantId("my-tenant-id");
      expect(result).toBe("my-tenant-id");
    });

    it("returns TenantId for short string", () => {
      const result = createTenantId("a");
      expect(result).toBe("a");
    });

    it("returns TenantId for long string", () => {
      const longString = "a".repeat(1000);
      const result = createTenantId(longString);
      expect(result).toBe(longString);
    });

    it("returns TenantId for string with special characters", () => {
      const result = createTenantId("tenant_123-test@example.com");
      expect(result).toBe("tenant_123-test@example.com");
    });

    it("returns TenantId for UUID-like strings", () => {
      const uuid = "550e8400-e29b-41d4-a716-446655440000";
      const result = createTenantId(uuid);
      expect(result).toBe(uuid);
    });

    it("returns TenantId for numeric strings", () => {
      const result = createTenantId("12345");
      expect(result).toBe("12345");
    });
  });

  describe("when value is empty or whitespace-only", () => {
    it("throws error for empty string", () => {
      expect(() => {
        createTenantId("");
      }).toThrow();
    });

    it("throws error for whitespace-only string with spaces", () => {
      expect(() => {
        createTenantId("   ");
      }).toThrow();
    });

    it("throws error for whitespace-only string with tabs", () => {
      expect(() => {
        createTenantId("\t\t\t");
      }).toThrow();
    });

    it("throws error for whitespace-only string with newlines", () => {
      expect(() => {
        createTenantId("\n\n\n");
      }).toThrow();
    });

    it("throws error for whitespace-only string with mixed whitespace", () => {
      expect(() => {
        createTenantId(" \t\n ");
      }).toThrow();
    });
  });

  describe("when value is not a string", () => {
    it("throws error for null", () => {
      expect(() => {
        createTenantId(null as unknown as string);
      }).toThrow();
    });

    it("throws error for undefined", () => {
      expect(() => {
        createTenantId(undefined as unknown as string);
      }).toThrow();
    });

    it("throws error for number", () => {
      expect(() => {
        createTenantId(123 as unknown as string);
      }).toThrow();
    });

    it("throws error for boolean", () => {
      expect(() => {
        createTenantId(true as unknown as string);
      }).toThrow();
    });

    it("throws error for object", () => {
      expect(() => {
        createTenantId({ id: "test" } as unknown as string);
      }).toThrow();
    });

    it("throws error for array", () => {
      expect(() => {
        createTenantId(["tenant"] as unknown as string);
      }).toThrow();
    });
  });

  describe("security considerations", () => {
    it("error message contains [SECURITY] prefix", () => {
      expect(() => {
        createTenantId("");
      }).toThrow(
        expect.objectContaining({
          message: expect.stringContaining("[SECURITY]"),
        }),
      );
    });

    it("error message mentions tenant isolation", () => {
      expect(() => {
        createTenantId("");
      }).toThrow(
        expect.objectContaining({
          message: expect.stringContaining("tenant isolation"),
        }),
      );
    });

    it("throws error with correct message format", () => {
      expect(() => {
        createTenantId("");
      }).toThrow(
        "[SECURITY] TenantId must be a non-empty string for tenant isolation",
      );
    });
  });
});
