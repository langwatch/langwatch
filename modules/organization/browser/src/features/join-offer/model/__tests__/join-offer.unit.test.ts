import { describe, expect, it } from "vitest";

import { joinOfferView } from "../join-offer.ts";

/** Spec: specs/identity/join-before-create.feature, specs/identity/join-requests.feature */

const acme = { organizationId: "org_acme", name: "Acme", colleagueCount: 10 };
const globex = { organizationId: "org_globex", name: "Globex", colleagueCount: 5 };

describe("joinOfferView", () => {
  describe("given somebody who already asked", () => {
    it("shows the wait, named by the offer that still carries the organization", () => {
      expect(
        joinOfferView({
          decision: { outcome: "ask", organizations: [acme] },
          waitingOn: [{ organizationId: "org_acme" }],
          currentOrganizationId: null,
        }),
      ).toEqual({ kind: "waiting", organizationName: "Acme" });
    });

    it("leaves the name out rather than guessing when the offer no longer carries it", () => {
      expect(
        joinOfferView({
          decision: { outcome: "none" },
          waitingOn: [{ organizationId: "org_acme" }],
          currentOrganizationId: null,
        }),
      ).toEqual({ kind: "waiting", organizationName: null });
    });
  });

  describe("given a dashboard showing one organization", () => {
    it("ignores a request for a different organization and an offer that does not name this one", () => {
      expect(
        joinOfferView({
          decision: { outcome: "ask", organizations: [globex] },
          waitingOn: [{ organizationId: "org_globex" }],
          currentOrganizationId: "org_acme",
        }),
      ).toEqual({ kind: "nothing" });
    });
  });

  describe("given an open offer and no request", () => {
    /** @scenario A dismissed offer reads exactly like no offer at all */
    it("offers the organizations, and a closed answer offers nothing", () => {
      expect(
        joinOfferView({
          decision: { outcome: "ask", organizations: [acme, globex] },
          waitingOn: [],
          currentOrganizationId: null,
        }),
      ).toEqual({ kind: "offer", organizations: [acme, globex] });
      expect(
        joinOfferView({
          decision: { outcome: "none" },
          waitingOn: [],
          currentOrganizationId: null,
        }),
      ).toEqual({ kind: "nothing" });
    });
  });
});
