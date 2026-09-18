import { describe, expect, it } from "vitest";

import { defineWebModule, installedDrawerLoaders } from "../src/index.ts";

const traceDrawer = { default: () => null };
const spanDrawer = { default: () => null };

const trace = defineWebModule("trace").withDrawers({
  traceDetails: { load: () => Promise.resolve(traceDrawer) },
  spanDetails: { load: () => Promise.resolve(spanDrawer) },
});

const evaluator = defineWebModule("evaluator").withDrawers({
  evaluatorEditor: { load: () => Promise.resolve({ default: () => null }) },
});

describe("installed drawers", () => {
  it("is empty for modules that declare none", () => {
    expect(installedDrawerLoaders([defineWebModule("annotation")])).toEqual({});
  });

  it("carries every declared drawer under the name the address bar uses", async () => {
    const loaders = installedDrawerLoaders([trace, evaluator]);

    expect(Object.keys(loaders).toSorted()).toEqual(["evaluatorEditor", "spanDetails", "traceDetails"]);
    await expect(loaders.traceDetails?.()).resolves.toBe(traceDrawer);
  });

  it("refuses two modules claiming one drawer name, naming both", () => {
    const rival = defineWebModule("scenario").withDrawers({
      traceDetails: { load: () => Promise.resolve({ default: () => null }) },
    });

    expect(() => installedDrawerLoaders([trace, rival])).toThrow(
      'Drawer "traceDetails" is declared by both "trace" and "scenario".',
    );
  });
});
