import { organizationUserRowSchema } from "@langwatch/organization-contract";
import { describe, expect, it } from "vitest";

import { userFromRecord } from "../prisma.organization.mapper.ts";

describe("userFromRecord", () => {
  /** @scenario "The member list carries the user's declared columns and no others" */
  it("carries only the declared columns, never the passkey signup claim hash", () => {
    const at = new Date("2026-09-30T00:00:00.000Z");
    const user = userFromRecord({
      id: "user_1",
      name: "Ada",
      email: "ada@example.com",
      emailVerified: true,
      signupConfirmationPending: false,
      passkeySignupClaimHash: "claim-hash",
      image: null,
      pendingSsoSetup: false,
      userHashKey: null,
      twoFactorEnabled: false,
      createdAt: at,
      updatedAt: at,
      lastLoginAt: null,
      deactivatedAt: null,
      lastHomePath: null,
      tracesExplorerTourDismissedAt: null,
      langyCodeAccessPreference: null,
      passkeyNudgeDismissedAt: null,
      joinOfferDismissedDomains: [],
    });

    expect(Object.keys(user).toSorted()).toEqual(
      Object.keys(organizationUserRowSchema.shape).toSorted(),
    );
    expect(user).not.toHaveProperty("passkeySignupClaimHash");
  });
});
