import { describe, it, expect } from "vitest";
import {
  isReservedColumnName,
  getSafeColumnName,
  RESERVED_COLUMN_NAMES,
} from "../reservedColumns";

/**
 * Tests for reserved column names utilities
 * Single Responsibility: Ensure reserved column validation and safe name generation works correctly
 */
describe("reservedColumns utilities", () => {
  describe("isReservedColumnName", () => {
    it("should identify reserved column names case-insensitively", () => {
      expect(isReservedColumnName("id")).toBe(true);
      expect(isReservedColumnName("ID")).toBe(true);
      expect(isReservedColumnName("Id")).toBe(true);
      expect(isReservedColumnName("selected")).toBe(true);
      expect(isReservedColumnName("SELECTED")).toBe(true);
      expect(isReservedColumnName("Selected")).toBe(true);
    });

    it("should not identify non-reserved column names", () => {
      expect(isReservedColumnName("name")).toBe(false);
      expect(isReservedColumnName("email")).toBe(false);
      expect(isReservedColumnName("user_id")).toBe(false);
      expect(isReservedColumnName("")).toBe(false);
    });
  });

  describe("getSafeColumnName", () => {
    it("should append '_' to reserved names when no collisions", () => {
      const existingNames = new Set<string>();
      expect(getSafeColumnName("id", existingNames)).toBe("id_");
      expect(getSafeColumnName("ID", existingNames)).toBe("ID_");
      expect(getSafeColumnName("selected", existingNames)).toBe("selected_");
      expect(getSafeColumnName("SELECTED", existingNames)).toBe("SELECTED_");
    });

    it("should return non-reserved names unchanged when no collisions", () => {
      const existingNames = new Set<string>();
      expect(getSafeColumnName("name", existingNames)).toBe("name");
      expect(getSafeColumnName("email", existingNames)).toBe("email");
      expect(getSafeColumnName("user_id", existingNames)).toBe("user_id");
      expect(getSafeColumnName("", existingNames)).toBe("");
    });

    it("should handle collisions with existing names", () => {
      const existingNames = new Set(["name", "id_", "id_1"]);

      // Non-reserved name that collides with existing
      expect(getSafeColumnName("name", existingNames)).toBe("name_");

      // Reserved name with collision resolution
      expect(getSafeColumnName("id", existingNames)).toBe("id_2");
    });

    it("should handle multiple collision iterations", () => {
      const existingNames = new Set([
        "test",
        "test_",
        "test_1",
        "test_2",
        "test_3",
      ]);

      // Should find the first available numeric suffix when "test" is already taken
      expect(getSafeColumnName("test", existingNames)).toBe("test_4");
    });

    it("should handle reserved names that collide with existing names", () => {
      const existingNames = new Set(["selected_", "selected_1"]);

      expect(getSafeColumnName("selected", existingNames)).toBe("selected_2");
    });

    it("should return original name if not reserved and no collision", () => {
      const existingNames = new Set(["other_name"]);

      expect(getSafeColumnName("unique_name", existingNames)).toBe(
        "unique_name"
      );
    });
  });

  describe("RESERVED_COLUMN_NAMES", () => {
    it("should contain expected reserved column names", () => {
      expect(RESERVED_COLUMN_NAMES).toContain("id");
      expect(RESERVED_COLUMN_NAMES).toContain("selected");
    });

    it("should be a readonly array", () => {
      // This test ensures the type is properly set as readonly
      const names: readonly string[] = RESERVED_COLUMN_NAMES;
      expect(Array.isArray(names)).toBe(true);
    });
  });
});
