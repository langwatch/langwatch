import { describe, expect, it } from "vitest";
import { operatorFeatureFlagCatalogueSchema } from "../src";

const updatedAt = new Date("2026-08-27T12:00:00.000Z");
const catalogue = {
  flags: [
    {
      key: "release_example",
      scope: "PRODUCT" as const,
      defaultValue: false,
      description: "An example flag",
      family: null,
      storedValue: true,
      rules: [{ match: { organizationId: "org_1" }, enabled: false }],
      envOverride: null,
      effective: true,
      lastEditedBy: "user_1",
      updatedAt,
    },
  ],
  families: [
    {
      family: "Event sourcing",
      keyPrefix: "es-",
      scope: "SYSTEM" as const,
      defaultValue: false,
      description: "Event-sourcing kill switches",
    },
  ],
};

describe("operator feature flag catalogue transport contract", () => {
  it("preserves every established response field", () => {
    expect(operatorFeatureFlagCatalogueSchema.parse(catalogue)).toEqual(catalogue);
  });

  it("refuses a response that drops an established field", () => {
    const incompleteFlag = { ...catalogue.flags[0], description: undefined };

    expect(() =>
      operatorFeatureFlagCatalogueSchema.parse({
        ...catalogue,
        flags: [incompleteFlag],
      }),
    ).toThrow();
  });
});
