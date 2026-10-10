import { describe, expect, it } from "vitest";

import { memberProvenanceFor, splitJoinAdmissions } from "../member-provenance.ts";

describe("memberProvenanceFor", () => {
  describe("given members who arrived three different ways", () => {
    it("names the domain, the invitation, and nothing for the one nobody can explain", () => {
      expect(
        memberProvenanceFor({
          userIds: ["sam", "ivy", "ana"],
          admissions: [{ userId: "sam", domain: "acme.com", automatic: true }],
          invitedUserIds: ["ivy"],
        }),
      ).toEqual({
        sam: { source: "domain", domain: "acme.com", automatic: true },
        ivy: { source: "invited" },
        ana: { source: "unknown" },
      });
    });
  });

  describe("given a member both invited and admitted by an approved request", () => {
    it("answers with the domain, which says who approved", () => {
      expect(
        memberProvenanceFor({
          userIds: ["sam"],
          admissions: [{ userId: "sam", domain: "acme.com", automatic: false }],
          invitedUserIds: ["sam"],
        }),
      ).toEqual({ sam: { source: "domain", domain: "acme.com", automatic: false } });
    });
  });

  describe("given a member the directory created who was also invited", () => {
    /** @scenario "A member a directory created is the directory's, whatever else is true" */
    it("answers with the directory and its provider", () => {
      expect(
        memberProvenanceFor({
          userIds: ["sam"],
          directoryMembers: [{ userId: "sam", providerId: "okta" }],
          ssoAdmissions: [{ userId: "sam", connectionId: "conn_1" }],
          admissions: [],
          invitedUserIds: ["sam"],
        }),
      ).toEqual({ sam: { source: "directory", providerId: "okta" } });
    });
  });

  describe("given a member single sign-on admitted on a matching domain", () => {
    /** @scenario "A member single sign-on admitted is explained by that connection" */
    it("answers with the connection rather than the domain", () => {
      expect(
        memberProvenanceFor({
          userIds: ["ivy"],
          ssoAdmissions: [{ userId: "ivy", connectionId: "conn_1" }],
          admissions: [{ userId: "ivy", domain: "acme.com", automatic: true }],
          invitedUserIds: [],
        }),
      ).toEqual({ ivy: { source: "sso", connectionId: "conn_1" } });
    });
  });
});

describe("splitJoinAdmissions", () => {
  /** @scenario "A member single sign-on admitted is explained by that connection" */
  it("separates single sign-on arrivals from domain admissions by their connection", () => {
    expect(
      splitJoinAdmissions([
        { userId: "ivy", domain: "acme.com", automatic: false, connectionId: "conn_1" },
        { userId: "sam", domain: "acme.com", automatic: true, connectionId: null },
      ]),
    ).toEqual({
      ssoAdmissions: [{ userId: "ivy", connectionId: "conn_1" }],
      admissions: [{ userId: "sam", domain: "acme.com", automatic: true, connectionId: null }],
    });
  });
});
