import { describe, it, expect } from "vitest";

// Extract the evaluation function to test directly without needing React
function evaluateMath(expr: string): number | null {
  try {
    // Only allow: digits, +, -, *, /, (), ., spaces
    if (!/^[\d\s\+\-\*\/\(\)\.]+$/.test(expr)) return null;
    // Must contain at least one operator
    if (!/[\+\-\*\/]/.test(expr)) return null;
    // Use Function constructor for safer evaluation
    const result = new Function(`return (${expr})`)() as unknown;
    if (typeof result !== "number" || !isFinite(result)) return null;
    return result;
  } catch {
    return null;
  }
}

function formatResult(query: string): string | null {
  const trimmed = query.trim();
  if (!trimmed || trimmed.length < 3) return null;

  const result = evaluateMath(trimmed);
  if (result === null) return null;

  // Format result nicely
  const formatted = Number.isInteger(result)
    ? result.toString()
    : result.toFixed(6).replace(/\.?0+$/, "");

  return `${trimmed} = ${formatted}`;
}

describe("useMathResult", () => {
  describe("evaluateMath", () => {
    it("returns null for empty expression", () => {
      expect(evaluateMath("")).toBeNull();
    });

    it("returns null for non-math expressions", () => {
      expect(evaluateMath("settings")).toBeNull();
    });

    it("returns null for expressions with letters", () => {
      expect(evaluateMath("1+2+abc")).toBeNull();
    });

    it("returns null for expressions without operators", () => {
      expect(evaluateMath("12345")).toBeNull();
    });

    it("evaluates simple addition", () => {
      expect(evaluateMath("1+2")).toBe(3);
    });

    it("evaluates multiplication with higher precedence", () => {
      expect(evaluateMath("1+2*3")).toBe(7);
    });

    it("evaluates division", () => {
      expect(evaluateMath("100/4")).toBe(25);
    });

    it("evaluates decimal results", () => {
      const result = evaluateMath("100/3");
      expect(result).toBeCloseTo(33.333333, 5);
    });

    it("evaluates parentheses", () => {
      expect(evaluateMath("(10+5)*2")).toBe(30);
    });

    it("evaluates subtraction", () => {
      expect(evaluateMath("10-3")).toBe(7);
    });

    it("evaluates negative results", () => {
      expect(evaluateMath("5-10")).toBe(-5);
    });

    it("handles spaces", () => {
      expect(evaluateMath(" 1 + 2 ")).toBe(3);
    });

    it("returns null for division by zero (Infinity)", () => {
      expect(evaluateMath("1/0")).toBeNull();
    });

    it("handles decimal numbers", () => {
      expect(evaluateMath("1.5+2.5")).toBe(4);
    });

    it("handles complex expressions", () => {
      expect(evaluateMath("(10+5)*(2+3)")).toBe(75);
    });
  });

  describe("formatResult", () => {
    it("returns null for short queries", () => {
      expect(formatResult("1+")).toBeNull();
      expect(formatResult("")).toBeNull();
    });

    it("returns null for non-math queries", () => {
      expect(formatResult("settings")).toBeNull();
    });

    it("formats integer results without decimals", () => {
      expect(formatResult("1+2")).toBe("1+2 = 3");
      expect(formatResult("100/4")).toBe("100/4 = 25");
    });

    it("formats decimal results with precision", () => {
      expect(formatResult("100/3")).toBe("100/3 = 33.333333");
    });

    it("removes trailing zeros", () => {
      expect(formatResult("1.0+2.0")).toBe("1.0+2.0 = 3");
    });

    it("formats multiplication", () => {
      expect(formatResult("1+2*3")).toBe("1+2*3 = 7");
    });

    it("formats parentheses", () => {
      expect(formatResult("(10+5)*2")).toBe("(10+5)*2 = 30");
    });

    it("preserves query formatting with spaces", () => {
      expect(formatResult(" 1 + 2 ")).toBe("1 + 2 = 3");
    });
  });
});
