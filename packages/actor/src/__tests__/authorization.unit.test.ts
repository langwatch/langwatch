import { describe, expect, it } from "vitest";
import {
  AuthorizationExpiredError,
  type AuthorizationInput,
  usableAuthorization,
  ForgedAuthorizationError,
  isSealedAuthorization,
  sealAuthorization,
} from "../index";

/**
 * ADR-166 / ADR-144 block B: the proof is sealed and it expires.
 *
 * @see specs/governance/aggregate-project.feature
 */

const NOW = 1_760_000_000_000;

function proof(overrides: Partial<AuthorizationInput> = {}): AuthorizationInput {
  return {
    actor: { type: "user", id: "user_ana" },
    principal: { type: "user", id: "user_ana" },
    scope: { organizationId: "org_acme" },
    grants: [
      {
        projectId: "proj_aggregate",
        permissions: ["traces:view", "analytics:view", "project:view"],
        via: ["grant_own"],
        kind: "own",
      },
      {
        projectId: "proj_member",
        permissions: ["traces:view"],
        via: ["grant_shared_1"],
        kind: "shared",
        condition: { type: "trace", from: NOW - 1_000, until: null },
      },
    ],
    expiresAt: NOW + 60_000,
    purpose: { kind: "route", route: "traces.list" },
    ...overrides,
  };
}

describe("the authorization proof", () => {
  describe("when minted through the seal", () => {
    it("is accepted by the usable check and is frozen", () => {
      const authorization = sealAuthorization(proof());
      expect(isSealedAuthorization(authorization)).toBe(true);
      expect(() =>
        usableAuthorization({ authorization, now: NOW }),
      ).not.toThrow();
      expect(Object.isFrozen(authorization)).toBe(true);
    });
  });

  describe("when a proof is assembled by hand", () => {
    /** @scenario "A proof built outside the authorizer is refused" */
    it("is refused as forged even with the same shape", () => {
      const byHand = proof();
      expect(isSealedAuthorization(byHand)).toBe(false);
      expect(() =>
        usableAuthorization({ authorization: byHand, now: NOW }),
      ).toThrow(ForgedAuthorizationError);
    });

    it("is refused when copied from a sealed one", () => {
      const sealed = sealAuthorization(proof());
      const copy = { ...sealed };
      expect(() =>
        usableAuthorization({ authorization: copy, now: NOW }),
      ).toThrow(ForgedAuthorizationError);
    });
  });

  describe("when the expiry has passed", () => {
    /** @scenario "An expired proof is refused" */
    it("is refused as expired, at and after the instant", () => {
      const authorization = sealAuthorization(proof({ expiresAt: NOW }));
      expect(() =>
        usableAuthorization({ authorization, now: NOW }),
      ).toThrow(AuthorizationExpiredError);
      expect(() =>
        usableAuthorization({ authorization, now: NOW + 1 }),
      ).toThrow(AuthorizationExpiredError);
      expect(() =>
        usableAuthorization({ authorization, now: NOW - 1 }),
      ).not.toThrow();
    });
  });

  describe("when the shape is wrong", () => {
    it("refuses to seal a proof with no grants, a shared grant without a condition, or an own grant with one", () => {
      expect(() => sealAuthorization(proof({ grants: [] }))).toThrow();
      expect(() =>
        sealAuthorization(
          proof({
            grants: [
              {
                projectId: "proj_member",
                permissions: ["traces:view"],
                via: ["grant_shared_1"],
                kind: "shared",
              },
            ],
          }),
        ),
      ).toThrow();
      expect(() =>
        sealAuthorization(
          proof({
            grants: [
              {
                projectId: "proj_aggregate",
                permissions: ["traces:view"],
                via: ["grant_own"],
                kind: "own",
                condition: { type: "trace", from: NOW, until: null },
              },
            ],
          }),
        ),
      ).toThrow();
    });

    it("refuses a shared grant that names no project and a purpose outside the vocabulary", () => {
      expect(() =>
        sealAuthorization(
          proof({
            grants: [
              {
                permissions: ["traces:view"],
                via: ["grant_shared_1"],
                kind: "shared",
                condition: { type: "trace", from: NOW, until: null },
              },
            ],
          }),
        ),
      ).toThrow();
      expect(() =>
        sealAuthorization(
          proof({
            purpose: { kind: "batch", route: "x" } as unknown as AuthorizationInput["purpose"],
          }),
        ),
      ).toThrow();
    });
  });
});
