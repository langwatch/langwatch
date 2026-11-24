/**
 * The Developer seats an operator may state on a licence or an activation code.
 */
import { MAX_STATED_SEATS } from "@langwatch/plans";
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

describe("the Developer seats an operator states", () => {
  /** @scenario An operator's Developer seats above the seat column's maximum are refused by name */
  it("refuses a count above the seat column's maximum, saying the limit", () => {
    const tooMany = { maxMembersDeveloper: MAX_STATED_SEATS + 1 };
    for (const result of [
      issueLicenseInputSchema.safeParse({ ...issue, ...tooMany }),
      reissueLicenseInputSchema.safeParse({ ...reissue, ...tooMany }),
      issueActivationCodeInputSchema.safeParse({ ...code, ...tooMany }),
    ]) {
      expect(result.success).toBe(false);
      expect(result.error?.issues[0]?.message).toContain(`at most ${MAX_STATED_SEATS}`);
    }
  });

  it("accepts 0, the maximum itself, and no count at all", () => {
    expect(issueLicenseInputSchema.validate({ ...issue, maxMembersDeveloper: 0 })).toBe(true);
    expect(
      reissueLicenseInputSchema.validate({ ...reissue, maxMembersDeveloper: MAX_STATED_SEATS }),
    ).toBe(true);
    expect(issueActivationCodeInputSchema.validate(code)).toBe(true);
  });

  it("refuses a fraction or a negative count", () => {
    expect(issueLicenseInputSchema.validate({ ...issue, maxMembersDeveloper: 1.5 })).toBe(false);
    expect(issueActivationCodeInputSchema.validate({ ...code, maxMembersDeveloper: -1 })).toBe(
      false,
    );
  });
});
