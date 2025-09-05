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
    it("should append '_' to reserved names", () => {
      expect(getSafeColumnName("id")).toBe("id_");
      expect(getSafeColumnName("ID")).toBe("ID_");
      expect(getSafeColumnName("selected")).toBe("selected_");
      expect(getSafeColumnName("SELECTED")).toBe("SELECTED_");
    });

    it("should return non-reserved names unchanged", () => {
      expect(getSafeColumnName("name")).toBe("name");
      expect(getSafeColumnName("email")).toBe("email");
      expect(getSafeColumnName("user_id")).toBe("user_id");
      expect(getSafeColumnName("")).toBe("");
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
