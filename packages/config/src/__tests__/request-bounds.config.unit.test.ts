import { describe, expect, it } from "vitest";

import { requestBounds } from "@langwatch/plans";
import { InvalidRuntimeConfigError, RuntimeConfig } from "../runtime-config.ts";
import {
  requestBoundsConfigDefinition,
  resolveRequestBoundsOverrides,
} from "../request-bounds.config.ts";

function resolve(source: Readonly<Record<string, unknown>>) {
  return RuntimeConfig.create({
    name: "request-bounds-block",
    definition: requestBoundsConfigDefinition,
    source,
  }).value;
}

describe("request-bounds configuration block", () => {
  it("resolves no overrides when the deployment named none", () => {
    expect(resolve({})).toEqual({ overrides: void 0 });
    expect(resolveRequestBoundsOverrides(resolve({}))).toEqual({});
    // An empty value reads as absent, like every other leaf.
    expect(resolveRequestBoundsOverrides(resolve({ LANGWATCH_REQUEST_BOUNDS: "" }))).toEqual({});
  });

  it("resolves a plain-number entry as an every-tier override", () => {
    const value = resolve({
      LANGWATCH_REQUEST_BOUNDS: JSON.stringify({ tracesPageSizeMax: 5_000 }),
    });

    expect(value.overrides).toEqual({ tracesPageSizeMax: 5_000 });
  });

  it("resolves a partial tier record, keeping only the tiers it names", () => {
    const value = resolve({
      LANGWATCH_REQUEST_BOUNDS: JSON.stringify({
        tracesPageSizeMax: { paid: 3_000, enterprise: 6_000 },
        exportPerMinute: { free: 3 },
      }),
    });

    expect(value.overrides).toEqual({
      tracesPageSizeMax: { paid: 3_000, enterprise: 6_000 },
      exportPerMinute: { free: 3 },
    });
    expect(resolveRequestBoundsOverrides(value)).toEqual({
      tracesPageSizeMax: { paid: 3_000, enterprise: 6_000 },
      exportPerMinute: { free: 3 },
    });
  });

  it("accepts every registry key with its paid value as a valid override", () => {
    const overrides = Object.fromEntries(requestBounds.map((bound) => [bound.key, bound.paid]));
    const value = resolve({
      LANGWATCH_REQUEST_BOUNDS: JSON.stringify(overrides),
    });

    expect(value.overrides).toEqual(overrides);
  });

  it("accepts a full tier record on a bound", () => {
    const value = resolve({
      LANGWATCH_REQUEST_BOUNDS: JSON.stringify({
        tracesPageSizeMax: { free: 800, paid: 1_600, enterprise: 3_200 },
      }),
    });

    expect(value.overrides).toEqual({
      tracesPageSizeMax: { free: 800, paid: 1_600, enterprise: 3_200 },
    });
  });

  it("refuses the boot on unknown bound keys, naming the key", () => {
    expect(() =>
      resolve({ LANGWATCH_REQUEST_BOUNDS: JSON.stringify({ noSuchBound: 10 }) }),
    ).toThrow(InvalidRuntimeConfigError);
    expect(() =>
      resolve({ LANGWATCH_REQUEST_BOUNDS: JSON.stringify({ noSuchBound: 10 }) }),
    ).toThrow(/noSuchBound/);
  });

  it("refuses the boot on unknown tier names, naming the tier", () => {
    expect(() =>
      resolve({
        LANGWATCH_REQUEST_BOUNDS: JSON.stringify({ tracesPageSizeMax: { platinum: 10 } }),
      }),
    ).toThrow(InvalidRuntimeConfigError);
    expect(() =>
      resolve({
        LANGWATCH_REQUEST_BOUNDS: JSON.stringify({ tracesPageSizeMax: { platinum: 10 } }),
      }),
    ).toThrow(/platinum/);
  });

  it.each([0, -1, 1.5, "100", null, ["free"], { free: "100" }])(
    "refuses the boot on the override value %s",
    (override) => {
      expect(() =>
        resolve({ LANGWATCH_REQUEST_BOUNDS: JSON.stringify({ tracesPageSizeMax: override }) }),
      ).toThrow(InvalidRuntimeConfigError);
    },
  );

  it.each(["not json at all", "[1, 2]", '"tracesPageSizeMax"'])(
    "refuses the boot on the document %s",
    (raw) => {
      expect(() => resolve({ LANGWATCH_REQUEST_BOUNDS: raw })).toThrow(InvalidRuntimeConfigError);
    },
  );
});
