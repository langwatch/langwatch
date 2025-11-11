import { describe, it, expect } from "vitest";
import { getProgressBarColor } from "../get-progress-bar-color";

describe("getProgressBarColor", () => {
  describe("when usage is below 70%", () => {
    it("returns green", () => {
      const result = getProgressBarColor(60);

      expect(result).toBe("#10b981");
    });
  });

  describe("when usage is at 70%", () => {
    it("returns orange", () => {
      const result = getProgressBarColor(70);

      expect(result).toBe("#f59e0b");
    });
  });

  describe("when usage is between 70% and 90%", () => {
    it("returns orange", () => {
      const result = getProgressBarColor(85);

      expect(result).toBe("#f59e0b");
    });
  });

  describe("when usage is at 90%", () => {
    it("returns orange", () => {
      const result = getProgressBarColor(90);

      expect(result).toBe("#f59e0b");
    });
  });

  describe("when usage is between 90% and 95%", () => {
    it("returns orange", () => {
      const result = getProgressBarColor(92);

      expect(result).toBe("#f59e0b");
    });
  });

  describe("when usage is at 95%", () => {
    it("returns red", () => {
      const result = getProgressBarColor(95);

      expect(result).toBe("#dc2626");
    });
  });

  describe("when usage is above 95%", () => {
    it("returns red", () => {
      const result = getProgressBarColor(100);

      expect(result).toBe("#dc2626");
    });
  });

  describe("when usage exceeds 100%", () => {
    it("returns red", () => {
      const result = getProgressBarColor(150);

      expect(result).toBe("#dc2626");
    });
  });
});

