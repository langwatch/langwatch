import { describe, expect, it } from "vitest";

import { system } from "../src/system/index.ts";

describe("drawer positioning", () => {
  it("keeps the positioner fixed to the viewport with end placement", () => {
    const recipe = system.getSlotRecipe("drawer");
    const styles = system.sva(recipe)({ size: "xl", placement: "end" });

    expect(styles.positioner).toMatchObject({
      "@layer recipes": {
        position: "fixed",
        justifyContent: "flex-end",
        top: 0,
      },
    });
    expect(styles.content).toMatchObject({
      "@layer recipes": { display: "flex", flexDirection: "column" },
    });
  });
});
