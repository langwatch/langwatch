import { DOMAIN_AUTO_JOIN_POLICY_ID, SSO_ARRIVAL_POLICY_ID } from "@langwatch/identity-contract";
import { describe, expect, it } from "vitest";

import { JoinAdmissionsService } from "../join-admissions.service.ts";

/** Spec: specs/identity/directory-administration.feature */

describe("given the members area asking which of its members a domain admitted", () => {
  /** @scenario A member who walked in on the domain policy says nobody approved */
  /** @scenario "A member single sign-on admitted is explained by that connection" */
  it("answers only the members it asked about, marking the policy's own admissions", async () => {
    const admissions = JoinAdmissionsService.create({
      findApprovedForOrganization: async () =>
        [
          { userId: "user_sam", domain: "acme.com", resolvedById: DOMAIN_AUTO_JOIN_POLICY_ID },
          { userId: "user_lee", domain: "acme.com", resolvedById: "user_ana" },
          { userId: "user_gone", domain: "acme.com", resolvedById: "user_ana" },
          {
            userId: "user_ivy",
            domain: "acme.com",
            resolvedById: SSO_ARRIVAL_POLICY_ID,
            connectionId: "conn_okta",
          },
        ] as Awaited<
          ReturnType<
            Parameters<typeof JoinAdmissionsService.create>[0]["findApprovedForOrganization"]
          >
        >,
    });

    const answered = await admissions.findForMembers({
      organizationId: "org_acme",
      userIds: ["user_sam", "user_lee", "user_ana", "user_ivy"],
    });

    expect(answered).toEqual([
      { userId: "user_sam", domain: "acme.com", automatic: true, connectionId: null },
      { userId: "user_lee", domain: "acme.com", automatic: false, connectionId: null },
      { userId: "user_ivy", domain: "acme.com", automatic: false, connectionId: "conn_okta" },
    ]);
  });
});
