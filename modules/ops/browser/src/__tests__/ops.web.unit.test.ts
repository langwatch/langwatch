/**
 * @vitest-environment jsdom
 * The declared drawers ARE the registry the browser composes, so each name
 * the address bar may carry has to answer with a real component.
 */
import { installedDrawerLoaders } from "@langwatch/ui-kernel";
import { describe, expect, it } from "vitest";

import { opsWeb } from "../ops.web.ts";

const drawers = installedDrawerLoaders([opsWeb]);

describe("the ops browser declaration", () => {
  it("declares the drawer names the product's addresses already carry", () => {
    expect(Object.keys(drawers).toSorted()).toEqual([
      "foundry",
      "opsBlobs",
      "opsGroupDetail",
      "opsProcessInstance",
      "opsProcessInstances",
      "opsReplay",
    ]);
  });

  it.each(Object.keys(drawers))("loads a component for %s", async (drawer) => {
    const loaded = await drawers[drawer]?.();

    expect(typeof (loaded as { default?: unknown }).default).toBe("function");
  });
});
