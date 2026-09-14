import { describe, expect, it } from "vitest";
import { createAbsentLicenseSource } from "../license-source.ts";

/**
 * Spec: specs/licensing/management-apis-enterprise-gate.feature
 *
 * The core fallback a process composition root names when it opened no
 * database — the other of the "two named factories"
 * (`entitlement-license-token` manifest) a composition root picks between,
 * alongside the Enterprise tier's `createActivatedLicenseSource`.
 */
describe("given a process that opened no database", () => {
  /** @scenario "A process with no database resolves the baseline plan" */
  it("answers unlicensed for every organization, unconditionally", async () => {
    const source = createAbsentLicenseSource();

    await expect(source.resolve({ organizationId: "org-1" })).resolves.toBeNull();
    await expect(source.resolve({ organizationId: "org-2" })).resolves.toBeNull();
  });
});
