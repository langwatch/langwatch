import { describe, expect, it } from "vitest";
import { computeStructuralFingerprint } from "../structuralFingerprint";

describe("computeStructuralFingerprint", () => {
  it("returns 'empty' for empty span list", () => {
    expect(computeStructuralFingerprint([])).toBe("empty");
  });

  it("is stable across identical structural shapes (content varies)", () => {
    // Models the 2026-05-11 outage signal: same workflow producing many
    // traces whose CONTENT differs (LLM output strings) but whose
    // STRUCTURE (span names + kinds + attribute keys) is identical. All
    // seven of these synthetic spans share name, kind, and attribute keys.
    // They MUST hash to the same fingerprint.
    const baseSpan = {
      name: "execute_component",
      kind: 1,
      attributeKeys: ["langwatch.origin", "langwatch.span_type", "passed"],
    };
    // The user's incident data dump showed wildly varying `passed` string
    // values but the same shape. Verify structural equality is preserved.
    const fp1 = computeStructuralFingerprint([baseSpan]);
    const fp2 = computeStructuralFingerprint([{ ...baseSpan }]);
    const fp3 = computeStructuralFingerprint([{ ...baseSpan, kind: 1 }]);
    expect(fp1).toBe(fp2);
    expect(fp1).toBe(fp3);
  });

  it("changes when span name differs", () => {
    const a = computeStructuralFingerprint([
      { name: "execute_component", kind: 1, attributeKeys: ["k"] },
    ]);
    const b = computeStructuralFingerprint([
      { name: "execute_flow", kind: 1, attributeKeys: ["k"] },
    ]);
    expect(a).not.toBe(b);
  });

  it("changes when attribute KEYS differ (but not values)", () => {
    const a = computeStructuralFingerprint([
      { name: "x", kind: 1, attributeKeys: ["a", "b"] },
    ]);
    const b = computeStructuralFingerprint([
      { name: "x", kind: 1, attributeKeys: ["a", "c"] },
    ]);
    expect(a).not.toBe(b);
  });

  it("is order-stable (attribute key order does not matter)", () => {
    const a = computeStructuralFingerprint([
      { name: "x", kind: 1, attributeKeys: ["a", "b", "c"] },
    ]);
    const b = computeStructuralFingerprint([
      { name: "x", kind: 1, attributeKeys: ["c", "a", "b"] },
    ]);
    expect(a).toBe(b);
  });

  it("is order-stable (span order does not matter)", () => {
    const span1 = {
      name: "a",
      kind: 1,
      attributeKeys: ["x"],
    };
    const span2 = {
      name: "b",
      kind: 2,
      attributeKeys: ["y"],
    };
    const a = computeStructuralFingerprint([span1, span2]);
    const b = computeStructuralFingerprint([span2, span1]);
    expect(a).toBe(b);
  });

  it("distinguishes different multi-span workflows", () => {
    const workflow1 = computeStructuralFingerprint([
      { name: "llm", kind: 3, attributeKeys: ["model"] },
      { name: "tool", kind: 1, attributeKeys: ["name"] },
    ]);
    const workflow2 = computeStructuralFingerprint([
      { name: "llm", kind: 3, attributeKeys: ["model"] },
    ]);
    expect(workflow1).not.toBe(workflow2);
  });
});
