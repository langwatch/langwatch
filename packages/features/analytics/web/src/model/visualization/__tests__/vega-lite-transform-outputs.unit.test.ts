/**
 * What `as` names, and what it does not.
 *
 * Vega-Lite's `bin` and `stack` take `as` as either one name or two. One name —
 * `as: "val"` — means the step writes `val` and `val_end`. Two names —
 * `as: ["lo", "hi"]` — means both outputs are already named, and nothing is
 * appended: there is no `lo_end`, and the transform never writes one.
 *
 * The distinction is load-bearing because `produces` is what the field
 * existence check reads. A name invented here is a name that check will accept
 * and the renderer will then look for in vain, so the error is fail-open — the
 * direction that lets a broken specification through rather than refusing a
 * working one.
 *
 * The `as`-less fallbacks are pinned in the same file on purpose. They encode
 * Vega's own defaults for a step that omits `as`, and nothing about fixing the
 * two-name case should move them.
 *
 * Node environment on purpose — see `validateVegaLiteSpec.unit.test.ts`.
 */
import { describe, expect, it } from "vitest";

import { analyzeTransform } from "../vega-lite-transforms";

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
