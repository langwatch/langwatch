import { describe, expect, it } from "vitest";

import { memberProvenanceFor } from "../member-provenance.rules.ts";

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
});
