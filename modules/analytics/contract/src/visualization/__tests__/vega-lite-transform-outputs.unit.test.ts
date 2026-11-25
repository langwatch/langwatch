/**
 * Vega-Lite's `as` can be one name (writes val, val_end) or two (nothing
 * appended); wrong names in `produces` cause fail-open errors. Node
 * environment — see `validateVegaLiteSpec.unit.test.ts`.
 */
import { describe, expect, it } from "vitest";

import { analyzeTransform } from "../vega-lite-transforms.ts";

describe("bin outputs", () => {
  it("takes both names from a two-name `as` and appends nothing", () => {
    const { produces } = analyzeTransform({
      bin: true,
      field: "amount",
      as: ["lo", "hi"],
    });

    expect([...produces]).toEqual(["lo", "hi"]);
  });

  it("appends `_end` to a single-name `as`", () => {
    const { produces } = analyzeTransform({
      bin: true,
      field: "amount",
      as: "val",
    });

    expect([...produces]).toEqual(["val", "val_end"]);
  });

  it("falls back to Vega's `bin_` names when `as` is absent", () => {
    const { produces } = analyzeTransform({ bin: true, field: "amount" });

    expect([...produces]).toEqual(["bin_amount", "bin_amount_end"]);
  });
});

describe("stack outputs", () => {
  it("takes both names from a two-name `as` and appends nothing", () => {
    const { produces } = analyzeTransform({
      stack: "amount",
      groupby: ["day"],
      as: ["lower", "upper"],
    });

    expect([...produces]).toEqual(["lower", "upper"]);
  });

  it("appends `_end` to a single-name `as`", () => {
    const { produces } = analyzeTransform({
      stack: "amount",
      groupby: ["day"],
      as: "band",
    });

    expect([...produces]).toEqual(["band", "band_end"]);
  });

  it("falls back to Vega's `_start`/`_end` pair when `as` is absent", () => {
    const { produces } = analyzeTransform({
      stack: "amount",
      groupby: ["day"],
    });

    expect([...produces]).toEqual(["amount_start", "amount_end"]);
  });
});
