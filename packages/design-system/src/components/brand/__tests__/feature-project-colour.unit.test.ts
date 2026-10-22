import { describe, expect, it } from "vitest";

import { featureProjectColour } from "../feature-project-colour.ts";

describe("featureProjectColour", () => {
  it("gives a project the same colour every time it is asked", () => {
    const first = featureProjectColour({ feature: "braids", projectId: "project_payments" });
    const again = featureProjectColour({ feature: "braids", projectId: "project_payments" });

    expect(again).toEqual(first);
  });

  it("names the fill and ink tokens of one of the brand's project colours", () => {
    const ids = ["project_a", "project_b", "project_c", "project_d", "project_e", "project_f"];
    const colours = ids.map((projectId) => featureProjectColour({ feature: "braids", projectId }));

    for (const { index, fill, ink, count } of colours) {
      expect(count).toBe(3);
      expect(index).toBeGreaterThanOrEqual(1);
      expect(index).toBeLessThanOrEqual(count);
      expect(fill).toBe(`feature.braids.project.${index}`);
      expect(ink).toBe(`feature.braids.projectInk.${index}`);
    }
    expect(new Set(colours.map(({ index }) => index)).size).toBeGreaterThan(1);
  });
});
