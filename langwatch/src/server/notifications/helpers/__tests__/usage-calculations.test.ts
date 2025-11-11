import { describe, it, expect } from "vitest";
import {
  calculateUsagePercentage,
  findCrossedThreshold,
  getSeverityLevel,
  USAGE_WARNING_THRESHOLDS,
} from "../usage-calculations";

describe("usage-calculations", () => {
  describe("calculateUsagePercentage", () => {
    describe("when limit is greater than zero", () => {
      it("calculates correct percentage", () => {
        const result = calculateUsagePercentage({
          currentUsage: 75,
          limit: 100,
        });

        expect(result).toBe(75);
      });
    });

    describe("when limit is zero", () => {
      it("returns zero to avoid division by zero", () => {
        const result = calculateUsagePercentage({
          currentUsage: 100,
          limit: 0,
        });

        expect(result).toBe(0);
      });
    });

    describe("when usage exceeds limit", () => {
      it("returns percentage over 100", () => {
        const result = calculateUsagePercentage({
          currentUsage: 150,
          limit: 100,
        });

        expect(result).toBe(150);
      });
    });
  });

  describe("findCrossedThreshold", () => {
    describe("when usage is below all thresholds", () => {
      it("returns undefined", () => {
        const result = findCrossedThreshold(45);

        expect(result).toBeUndefined();
      });
    });

    describe("when usage crosses 50% threshold", () => {
      it("returns 50", () => {
        const result = findCrossedThreshold(55);

        expect(result).toBe(50);
      });
    });

    describe("when usage crosses 70% threshold", () => {
      it("returns 70", () => {
        const result = findCrossedThreshold(75);

        expect(result).toBe(70);
      });
    });

    describe("when usage crosses 90% threshold", () => {
      it("returns 90", () => {
        const result = findCrossedThreshold(92);

        expect(result).toBe(90);
      });
    });

    describe("when usage crosses 95% threshold", () => {
      it("returns 95", () => {
        const result = findCrossedThreshold(97);

        expect(result).toBe(95);
      });
    });

    describe("when usage is at 100%", () => {
      it("returns 100", () => {
        const result = findCrossedThreshold(100);

        expect(result).toBe(100);
      });
    });

    describe("when usage exceeds 100%", () => {
      it("returns 100 as highest threshold", () => {
        const result = findCrossedThreshold(150);

        expect(result).toBe(100);
      });
    });
  });

  describe("getSeverityLevel", () => {
    describe("when threshold is 100", () => {
      it("returns Critical", () => {
        const result = getSeverityLevel(100);

        expect(result).toBe("Critical");
      });
    });

    describe("when threshold is 95", () => {
      it("returns Critical", () => {
        const result = getSeverityLevel(95);

        expect(result).toBe("Critical");
      });
    });

    describe("when threshold is 90", () => {
      it("returns High", () => {
        const result = getSeverityLevel(90);

        expect(result).toBe("High");
      });
    });

    describe("when threshold is 70", () => {
      it("returns Medium", () => {
        const result = getSeverityLevel(70);

        expect(result).toBe("Medium");
      });
    });

    describe("when threshold is 50", () => {
      it("returns Info", () => {
        const result = getSeverityLevel(50);

        expect(result).toBe("Info");
      });
    });
  });

  describe("USAGE_WARNING_THRESHOLDS", () => {
    it("contains expected thresholds in ascending order", () => {
      expect(USAGE_WARNING_THRESHOLDS).toEqual([50, 70, 90, 95, 100]);
    });
  });
});

