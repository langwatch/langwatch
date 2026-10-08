import { DOMAIN_AUTO_JOIN_POLICY_ID } from "@langwatch/identity-contract";
import { describe, expect, it } from "vitest";

import { JoinAdmissionsService } from "../join-admissions.service.ts";

/** Spec: specs/identity/directory-administration.feature */

describe("given the members area asking which of its members a domain admitted", () => {
  /** @scenario A member who walked in on the domain policy says nobody approved */
  it("answers only the members it asked about, marking the policy's own admissions", async () => {
    const admissions = JoinAdmissionsService.create({
      findApprovedForOrganization: async () =>
        [
          { userId: "user_sam", domain: "acme.com", resolvedById: DOMAIN_AUTO_JOIN_POLICY_ID },
          { userId: "user_lee", domain: "acme.com", resolvedById: "user_ana" },
          { userId: "user_gone", domain: "acme.com", resolvedById: "user_ana" },
        ] as Awaited<
          ReturnType<
            Parameters<typeof JoinAdmissionsService.create>[0]["findApprovedForOrganization"]
          >
        >,
    });

    const answered = await admissions.findForMembers({
      organizationId: "org_acme",
      userIds: ["user_sam", "user_lee", "user_ana"],
    });

    expect(answered).toEqual([
      { userId: "user_sam", domain: "acme.com", automatic: true },
      { userId: "user_lee", domain: "acme.com", automatic: false },
    ]);
  });
});
