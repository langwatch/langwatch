/**
 * The lite seats an operator may state on a license or an activation code (WEB-19102).
 */
import { MAX_STATED_LITE_SEATS } from "@langwatch/plans";
import { describe, expect, it } from "vitest";

import { issueActivationCodeInputSchema } from "../activation-code.ts";
import { issueLicenseInputSchema, reissueLicenseInputSchema } from "../license-registry.ts";

const issue = {
  customer: { organizationId: "org-acme" },
  email: "ops@acme.test",
  planType: "ENTERPRISE",
  maxMembers: 10,
  expiresAt: "2027-01-01T00:00:00Z",
};
const reissue = { id: "row-1", expiresAt: "2027-01-01T00:00:00Z" };
const code = {
  organizationId: "org-acme",
  organizationName: "ACME",
  email: "ops@acme.test",
  planType: "ENTERPRISE",
  maxMembers: 10,
  licenseTermDays: 365,
  expiresAt: "2027-01-01T00:00:00Z",
};

describe("the lite seats an operator states", () => {
  /** @scenario An operator's lite seats above the seat column's maximum are refused by name */
  it("refuses a count above the seat column's maximum, saying the limit", () => {
    for (const result of [
      issueLicenseInputSchema.safeParse({ ...issue, maxMembersLite: MAX_STATED_LITE_SEATS + 1 }),
      reissueLicenseInputSchema.safeParse({
        ...reissue,
        maxMembersLite: MAX_STATED_LITE_SEATS + 1,
      }),
      issueActivationCodeInputSchema.safeParse({
        ...code,
        maxMembersLite: MAX_STATED_LITE_SEATS + 1,
      }),
    ]) {
      expect(result.success).toBe(false);
      expect(result.error?.issues[0]?.message).toContain(`at most ${MAX_STATED_LITE_SEATS}`);
    }
  });

  it("accepts the maximum itself, and no count at all", () => {
    expect(
      issueLicenseInputSchema.validate({ ...issue, maxMembersLite: MAX_STATED_LITE_SEATS }),
    ).toBe(true);
    expect(issueActivationCodeInputSchema.validate(code)).toBe(true);
  });
});
