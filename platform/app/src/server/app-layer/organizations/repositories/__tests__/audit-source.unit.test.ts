/** @vitest-environment node */

/**
 * A change the directory made is told apart from one an administrator made by
 * hand, on the organization's own audit page (D08 / ADR-122).
 *
 * The stamp is the grant fact's own `source`, carried onto the audit row's
 * metadata by the grants audit subscriber — so this is not a second opinion
 * about who acted, it is the same recorded fact read on a second surface.
 * That matters because a directory-authored row has a NULL user (the actor is
 * a system principal), and left unlabelled it renders as a change with no
 * author, which is the reading that sends somebody hunting for a person who
 * does not exist.
 *
 * @see specs/identity/scim-connection-sync.feature
 */
import { describe, expect, it } from "vitest";
import { auditSourceOf } from "../organization.prisma.repository";

describe("what an audit row says made the change", () => {
  describe("given a membership change the directory authored", () => {
    /** @scenario "Directory-sourced membership changes stay on the customer's audit page" */
    it("names the directory, and tells it apart from a change made by hand", () => {
      const byTheDirectory = auditSourceOf({
        action: "authz.grants.revoke",
        metadata: { grantId: "grant_sam", source: "scim" },
        isGateway: false,
      });
      const byAnAdministrator = auditSourceOf({
        action: "authz.grants.revoke",
        metadata: { grantId: "grant_kim", source: "grants-service" },
        isGateway: false,
      });

      expect(byTheDirectory).toBe("directory");
      expect(byAnAdministrator).toBe("platform");
      expect(byTheDirectory).not.toBe(byAnAdministrator);
    });

    it("stays on the page as an attachment as well as a removal", () => {
      expect(
        auditSourceOf({
          action: "authz.grants.attach",
          metadata: { source: "scim" },
          isGateway: false,
        }),
      ).toBe("directory");
    });
  });

  describe("given a row that only looks directory-authored", () => {
    it("does not claim the directory made something that is not a membership change", () => {
      // The stamp alone is not enough: a row carrying the word for another
      // reason is not a grant the directory wrote.
      expect(
        auditSourceOf({
          action: "management.scimToken.create",
          metadata: { source: "scim" },
          isGateway: false,
        }),
      ).toBe("platform");
    });

    it("leaves a gateway row alone", () => {
      expect(
        auditSourceOf({
          action: "gateway.budget.update",
          metadata: { source: "scim" },
          isGateway: true,
        }),
      ).toBe("gateway");
    });

    it("survives a row with no metadata at all", () => {
      expect(
        auditSourceOf({
          action: "authz.grants.attach",
          metadata: null,
          isGateway: false,
        }),
      ).toBe("platform");
    });
  });
});
