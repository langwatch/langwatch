import { describe, expect, it } from "vitest";

import { formatRate, parseRate } from "../cost-rate-text.ts";

describe("formatRate", () => {
  it("writes tiny rates as plain decimals", () => {
    expect(formatRate(1.155e-7)).toBe("0.0000001155");
    expect(formatRate(2.625e-7)).toBe("0.0000002625");
    expect(formatRate(4.2e-7)).toBe("0.00000042");
    expect(formatRate(0.000001)).toBe("0.000001");
  });

  it("leaves ordinary and empty values alone", () => {
    expect(formatRate(0.9)).toBe("0.9");
    expect(formatRate(0)).toBe("0");
    expect(formatRate(undefined)).toBe("");
  });
});

describe("parseRate", () => {
  it("reads plain decimals and tolerates a pasted exponent", () => {
    expect(parseRate("0.0000001155")).toBe(1.155e-7);
    expect(parseRate("1.2e-7")).toBe(1.2e-7);
  });

  it("treats blank and junk as no rate", () => {
    expect(parseRate("")).toBeUndefined();
    expect(parseRate("abc")).toBeUndefined();
  });
});
