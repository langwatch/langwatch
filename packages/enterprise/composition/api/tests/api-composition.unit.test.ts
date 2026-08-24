import { describe, expect, it } from "vitest";
import { EnterpriseApiComposition } from "../src";
import type { LicensingService } from "@langwatch/enterprise-licensing-contract";

describe("EnterpriseApiComposition", () => {
  it("retains an explicitly supplied licensing capability", () => {
    const licensing = {} as LicensingService;
    const composition = EnterpriseApiComposition.create({ licensing });

    expect(composition.licensing).toBe(licensing);
    expect(composition.catalogue.get("licensing")).toBeDefined();
  });
});
