import { describe, expect, it } from "vitest";
import {
  permissionDecisionRecord,
  principalOfSession,
} from "../decision-record";
import { isImpersonating, ownPrincipal } from "../principal";

/**
 * Who an authorization decision names (D06).
 *
 * The record is built as a value and logged separately, so what a decision
 * says about who made it is a property of this function rather than of a log
 * transport — which is what lets "the decision records both people" be
 * asserted rather than inspected by eye.
 */

const scope = { tier: "organization", id: "org_acme" } as const;

describe("an authorization decision", () => {
  describe("given an operator impersonating somebody", () => {
    const principal = {
      actor: { userId: "operator_1" },
      subject: { userId: "sam" },
    };

    describe("when any authorization decision is made for that session", () => {
      /** @scenario "Every authorization decision under impersonation names both people" */
      it("records the operator and the person whose access was borrowed", () => {
        const record = permissionDecisionRecord({
          principal,
          permission: "organization:manage",
          scope,
          permitted: true,
        });

        expect(record.actorUserId).toBe("operator_1");
        expect(record.subjectUserId).toBe("sam");
        expect(record.impersonating).toBe(true);
      });

      /** @scenario "Every authorization decision under impersonation names both people" */
      it("names both on a refusal as well as on a grant", () => {
        const record = permissionDecisionRecord({
          principal,
          permission: "organization:manage",
          scope,
          permitted: false,
          denialReason: "no-binding",
        });

        expect(record).toMatchObject({
          actorUserId: "operator_1",
          subjectUserId: "sam",
          impersonating: true,
          permitted: false,
          denialReason: "no-binding",
          permission: "organization:manage",
          scopeTier: "organization",
          scopeId: "org_acme",
        });
      });

      /** @scenario "Every authorization decision under impersonation names both people" */
      it("can answer who really did it from the record alone", () => {
        const record = permissionDecisionRecord({
          principal,
          permission: "project:view",
          scope: { tier: "project", id: "proj_1" },
          permitted: true,
        });

        // The question the audit trail has to answer, asked of the record.
        expect(record.actorUserId).not.toBe(record.subjectUserId);
        expect(record.actorUserId).toBe("operator_1");
      });
    });
  });

  describe("given somebody acting as themselves", () => {
    it("names the same person twice rather than nobody", () => {
      const record = permissionDecisionRecord({
        principal: ownPrincipal({ userId: "sam" }),
        permission: "project:view",
        scope: { tier: "project", id: "proj_1" },
        permitted: true,
      });

      expect(record.actorUserId).toBe("sam");
      expect(record.subjectUserId).toBe("sam");
      expect(record.impersonating).toBe(false);
    });
  });

  describe("when the session carries its own principal", () => {
    it("takes the pair the session resolved", () => {
      const principal = {
        actor: { userId: "operator_1" },
        subject: { userId: "sam" },
      };
      expect(
        principalOfSession({
          session: { user: { id: "sam" }, principal },
        }),
      ).toEqual(principal);
    });
  });

  describe("when the session was built without a principal", () => {
    it("reads an impersonator on it as the actor", () => {
      const resolved = principalOfSession({
        session: { user: { id: "sam", impersonator: { id: "operator_1" } } },
      });
      expect(resolved).toEqual({
        actor: { userId: "operator_1" },
        subject: { userId: "sam" },
      });
      expect(isImpersonating(resolved)).toBe(true);
    });

    it("never invents an impersonation for an ordinary session", () => {
      const resolved = principalOfSession({ session: { user: { id: "sam" } } });
      expect(resolved).toEqual({
        actor: { userId: "sam" },
        subject: { userId: "sam" },
      });
      expect(isImpersonating(resolved)).toBe(false);
    });

    it("reads an impersonator of oneself as no impersonation at all", () => {
      const resolved = principalOfSession({
        session: { user: { id: "sam", impersonator: { id: "sam" } } },
      });
      expect(isImpersonating(resolved)).toBe(false);
    });
  });
});
