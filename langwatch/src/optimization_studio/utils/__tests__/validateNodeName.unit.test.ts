import { describe, it, expect } from "vitest";
import { validateNodeName } from "../nodeUtils";

describe("validateNodeName", () => {
  const defaultArgs = {
    currentNodeId: "code1",
    existingNodeIds: ["code1", "fetch_data", "entry", "end"],
  };

  describe("when name is empty", () => {
    it("rejects the rename", () => {
      const result = validateNodeName({ ...defaultArgs, name: "" });
      expect(result.valid).toBe(false);
    });
  });

  describe("when name is whitespace-only", () => {
    it("rejects the rename", () => {
      const result = validateNodeName({ ...defaultArgs, name: "   " });
      expect(result.valid).toBe(false);
    });
  });

  describe("when name collides with another node", () => {
    it("rejects the rename", () => {
      const result = validateNodeName({
        ...defaultArgs,
        name: "fetch_data",
      });
      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.error).toContain("already exists");
      }
    });
  });

  describe("when name matches current node id", () => {
    it("accepts the rename (no-op rename)", () => {
      const result = validateNodeName({ ...defaultArgs, name: "code1" });
      expect(result.valid).toBe(true);
    });
  });

  describe("when name is an invalid Python identifier", () => {
    it("rejects names starting with a digit", () => {
      const result = validateNodeName({ ...defaultArgs, name: "123invalid" });
      expect(result.valid).toBe(false);
    });

    it("rejects names with special characters", () => {
      const result = validateNodeName({ ...defaultArgs, name: "my-block!" });
      expect(result.valid).toBe(false);
    });
  });

  describe("when name contains underscores", () => {
    it("accepts the rename", () => {
      const result = validateNodeName({
        ...defaultArgs,
        name: "fetch_user_data",
      });
      expect(result.valid).toBe(true);
    });
  });

  describe("when name contains spaces", () => {
    it("accepts the rename (spaces convert to underscores)", () => {
      const result = validateNodeName({
        ...defaultArgs,
        name: "fetch user data",
      });
      expect(result.valid).toBe(true);
    });
  });
});
