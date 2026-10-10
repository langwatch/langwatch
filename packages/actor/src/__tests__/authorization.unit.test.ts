import { describe, expect, it } from "vitest";
import {
  type Authorization,
  AuthorizationExpiredError,
  type AuthorizationInput,
  usableAuthorization,
  ForgedAuthorizationError,
  isSealedAuthorization,
  narrowAuthorization,
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

    it("freezes every nested object, so a holder cannot rewrite a grant", () => {
      const authorization = sealAuthorization(proof());
      const [own, member] = authorization.grants;
      if (!own || !member) throw new Error("the fixture proof has two grants");

      for (const nested of [
        authorization.actor,
        authorization.principal,
        authorization.scope,
        authorization.purpose,
        authorization.grants,
        own,
        own.permissions,
        own.via,
        member,
        member.condition,
        member.permissions,
        member.via,
      ]) {
        expect(Object.isFrozen(nested)).toBe(true);
      }
      expect(() => {
        (member as { projectId?: string }).projectId = "proj_outsider";
      }).toThrow(TypeError);
      expect(() => {
        (member.condition as { from: number }).from = 0;
      }).toThrow(TypeError);
      expect(member.projectId).toBe("proj_member");
      expect(member.condition?.from).toBe(NOW - 1_000);
      expect(isSealedAuthorization(authorization)).toBe(true);
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

  describe("when a proof is narrowed to one of its projects", () => {
    it("keeps only the own grant and that project's, with the expiry and purpose", () => {
      const [own, member] = proof().grants;
      const other = {
        projectId: "proj_other_member",
        permissions: ["traces:view"],
        via: ["grant_shared_2"],
        kind: "shared" as const,
        condition: { type: "trace" as const, from: NOW - 1_000, until: null },
      };
      if (!own || !member) throw new Error("the fixture proof has two grants");
      const authorization = sealAuthorization(
        proof({ grants: [own, member, other] }),
      );
      const narrowed = narrowAuthorization({
        authorization,
        projectId: "proj_member",
      });

      expect(narrowed).not.toBeNull();
      expect(isSealedAuthorization(narrowed)).toBe(true);
      expect(narrowed?.narrowedTo).toBe("proj_member");
      // A structural cut: a later reader of the grants cannot widen the
      // narrowed proof back to the member it was cut away from.
      expect(narrowed?.grants).toEqual([own, member]);
      expect(narrowed?.expiresAt).toBe(authorization.expiresAt);
      expect(narrowed?.purpose).toEqual(authorization.purpose);
      expect(authorization.narrowedTo).toBeUndefined();
      expect(authorization.grants).toHaveLength(3);
    });

    it("returns null for a project the proof does not name", () => {
      const authorization = sealAuthorization(proof());

      expect(
        narrowAuthorization({ authorization, projectId: "proj_outsider" }),
      ).toBeNull();
    });

    it("never moves a narrowed proof onto another project", () => {
      const narrowed = narrowAuthorization({
        authorization: sealAuthorization(proof()),
        projectId: "proj_member",
      });
      if (!narrowed) throw new Error("expected a narrowed proof");

      expect(
        narrowAuthorization({ authorization: narrowed, projectId: "proj_aggregate" }),
      ).toBeNull();
      expect(
        narrowAuthorization({ authorization: narrowed, projectId: "proj_member" }),
      ).toBe(narrowed);
    });

    it("refuses to narrow a proof assembled by hand", () => {
      const byHand = { ...sealAuthorization(proof()) } as Authorization;

      expect(() =>
        narrowAuthorization({ authorization: byHand, projectId: "proj_member" }),
      ).toThrow(ForgedAuthorizationError);
    });

    it("refuses a seal that names a project outside its grants", () => {
      expect(() =>
        sealAuthorization({ ...proof(), narrowedTo: "proj_outsider" }),
      ).toThrow();
    });
  });
});
