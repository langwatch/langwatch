import { declareDrawers, navigateToDrawer } from "@langwatch/browser-host/drawer";
import { describe, expect, it } from "vitest";

import { defineBrowserModule, installedDrawerLoaders } from "../src/index.ts";
import { installedModuleDrawers } from "../src/module/ui-module-drawers.ts";

const traceDrawer = { default: () => null };
const spanDrawer = { default: () => null };

const trace = defineBrowserModule("trace").withDrawers({
  traceDetails: { load: () => Promise.resolve(traceDrawer) },
  spanDetails: { load: () => Promise.resolve(spanDrawer) },
});

const evaluator = defineBrowserModule("evaluator").withDrawers({
  evaluatorEditor: {
    load: () => Promise.resolve({ default: () => null }),
  },
});

describe("installed drawers", () => {
  it("is empty for modules that declare none", () => {
    expect(installedDrawerLoaders([defineBrowserModule("annotation")])).toEqual({});
  });

  it("carries every declared drawer under the name the address bar uses", async () => {
    const loaders = installedDrawerLoaders([trace, evaluator]);

    expect(Object.keys(loaders).toSorted()).toEqual([
      "evaluatorEditor",
      "spanDetails",
      "traceDetails",
    ]);
    await expect(loaders.traceDetails?.()).resolves.toBe(traceDrawer);
  });

  /**
   * @scenario Two features serving the same drawer name are refused by name
   * @scenario "Two modules declaring one drawer name fail the build"
   */
  it("refuses two modules claiming one drawer name, naming both", () => {
    const rival = defineBrowserModule("scenario").withDrawers({
      traceDetails: { load: () => Promise.resolve({ default: () => null }) },
    });

    expect(() => installedDrawerLoaders([trace, rival])).toThrow(
      'Drawer "traceDetails" is declared by both "trace" and "scenario".',
    );
  });

  /** @scenario "A module declaring no drawers contributes none" */
  it("composes nothing from a module declaring screens only, and refuses its undeclared name", () => {
    const screensOnly = defineBrowserModule("annotation").withScreens({
      "pages/annotations": { path: "/annotations" },
    });
    const registry = installedModuleDrawers([trace, screensOnly]);
    const undeclare = declareDrawers(registry);

    try {
      expect(Object.keys(registry).toSorted()).toEqual(["spanDetails", "traceDetails"]);
      expect(() => navigateToDrawer("annotationEditor")).toThrow(
        expect.objectContaining({ code: "browser_drawer_undeclared", drawer: "annotationEditor" }),
      );
    } finally {
      undeclare();
    }
  });
});
