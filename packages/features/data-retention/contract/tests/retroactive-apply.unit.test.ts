import { describe, expect, it } from "vitest";
import { classifyRetentionChange } from "../src/data-retention";

describe("classifyRetentionChange", () => {
  it("identifies a shorter finite window as a contraction", () => {
    expect(classifyRetentionChange({ current: 91, next: 49 })).toBe("contraction");
  });

  it("identifies replacing indefinite retention with a finite window as a contraction", () => {
    expect(classifyRetentionChange({ current: 0, next: 49 })).toBe("contraction");
  });

  it("identifies a longer finite window as an expansion", () => {
    expect(classifyRetentionChange({ current: 49, next: 91 })).toBe("expansion");
  });

  it("identifies indefinite retention as an expansion", () => {
    expect(classifyRetentionChange({ current: 49, next: 0 })).toBe("expansion");
  });

  it("identifies unchanged finite and indefinite windows as no-ops", () => {
    expect(classifyRetentionChange({ current: 49, next: 49 })).toBe("noop");
    expect(classifyRetentionChange({ current: 0, next: 0 })).toBe("noop");
  });
});
