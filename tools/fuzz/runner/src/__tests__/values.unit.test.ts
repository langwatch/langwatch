import { describe, expect, it } from "vitest";

import { mulberry32 } from "../rng.ts";
import { VALUE_FAMILIES, preview, valueFor } from "../values.ts";

describe("valueFor", () => {
  it("is deterministic for a seed", () => {
    const draw = (seed: number) =>
      Array.from(
        { length: 30 },
        (
          (rng) => () =>
            valueFor({ rng })
        )(mulberry32(seed)),
      );
    expect(draw(5)).toEqual(draw(5));
  });

  it("draws every family", () => {
    const rng = mulberry32(2);
    const families = new Set(Array.from({ length: 300 }, () => valueFor({ rng }).family));
    expect(families).toEqual(new Set(VALUE_FAMILIES));
  });

  it("makes each family what it says", () => {
    const rng = mulberry32(1);
    expect(valueFor({ rng, family: "empty" }).value).toBe("");
    expect(valueFor({ rng, family: "huge" }).value.length).toBeGreaterThanOrEqual(100_000);
    expect(valueFor({ rng, family: "unicode" }).value).toMatch(/[^\p{ASCII}]/u);
    expect(valueFor({ rng, family: "bounds" }).value).toMatch(/^-?[\d.e+-]+$/);
    expect(valueFor({ rng, family: "injection" }).value.length).toBeGreaterThan(0);
  });

  it("keeps a numeric field to numbers", () => {
    const rng = mulberry32(9);
    for (let index = 0; index < 200; index++) {
      expect(Number.isNaN(Number(valueFor({ rng, numeric: true }).value))).toBe(false);
    }
  });

  it("previews a huge value without carrying it", () => {
    expect(preview({ family: "huge", value: "A".repeat(100_000) }).length).toBeLessThan(60);
  });
});
