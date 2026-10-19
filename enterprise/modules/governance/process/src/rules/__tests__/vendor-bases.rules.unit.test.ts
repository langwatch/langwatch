import { describe, expect, it } from "vitest";

import { exemptOriginsOf, REAL_VENDOR_BASES, vendorBasesOf } from "../vendor-bases.rules.ts";

const unset = {
  openAiAdminApiBase: undefined,
  anthropicAdminApiBase: undefined,
  microsoftLoginBase: undefined,
  microsoftGraphApiBase: undefined,
  databricksWorkspaceBase: undefined,
  dataverseEnvironmentBase: undefined,
};

describe("vendorBasesOf()", () => {
  /** @scenario "A vendor base that is unset or blank reaches the real vendor" */
  it("is the real vendor for every leaf when nothing is configured", () => {
    expect(vendorBasesOf({ config: unset })).toEqual(REAL_VENDOR_BASES);
    expect(vendorBasesOf({ config: undefined })).toEqual(REAL_VENDOR_BASES);
  });

  /** @scenario "A pulled vendor is reached at the base the deployment configures" */
  it("uses a configured base, without its trailing slash", () => {
    const bases = vendorBasesOf({
      config: { ...unset, openAiAdminApiBase: "http://localhost:6970/openai/" },
    });
    expect(bases.openAiAdmin).toBe("http://localhost:6970/openai");
    expect(bases.anthropicAdmin).toBe(REAL_VENDOR_BASES.anthropicAdmin);
  });
});

describe("exemptOriginsOf()", () => {
  it("exempts nothing when every base is the real vendor", () => {
    expect(exemptOriginsOf({ bases: REAL_VENDOR_BASES })).toEqual([]);
  });

  /** @scenario "Only the configured vendor base is exempt from the local-address fence" */
  it("exempts the origin of each configured base and no other", () => {
    const bases = vendorBasesOf({
      config: {
        ...unset,
        anthropicAdminApiBase: "http://localhost:6970/anthropic",
        databricksWorkspaceBase: "http://localhost:6970",
        dataverseEnvironmentBase: "http://localhost:6970/dataverse/",
      },
    });
    expect(bases.dataverseEnvironment).toBe("http://localhost:6970/dataverse");
    expect(exemptOriginsOf({ bases })).toEqual([
      "http://localhost:6970",
      "http://localhost:6970",
      "http://localhost:6970",
    ]);
  });
});
