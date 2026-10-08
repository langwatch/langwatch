import { HandledError } from "@langwatch/handled-error";
import { describe, expect, it } from "vitest";

import {
  AccessNotGrantedError,
  type Authorization,
  type AuthorizationInput,
  isSealedAuthorization,
  narrowAuthorization,
  sealAuthorization,
  usableAuthorization,
} from "../index.ts";
import { aggregateProof, ownProof } from "./support/authorization-proofs.ts";

/**
 * ADR-166 / ADR-175: the proof is sealed and it expires.
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

/** The handled code a call throws, or the plain error when it throws something else. */
function codeOf(run: () => unknown): unknown {
  try {
    run();
  } catch (error) {
    return HandledError.isHandled(error) ? error.code : error;
  }
  return null;
}

describe("the authorization proof", () => {
  describe("when minted through the seal", () => {
    it("is accepted by the usable check and is frozen", () => {
      const authorization = sealAuthorization(proof());
      expect(isSealedAuthorization(authorization)).toBe(true);
      expect(() => usableAuthorization({ authorization, now: NOW })).not.toThrow();
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
      expect(codeOf(() => usableAuthorization({ authorization: byHand, now: NOW }))).toBe(
        "authorization_forged",
      );
    });

    it("is refused when copied from a sealed one", () => {
      const copy = { ...sealAuthorization(proof()) };
      expect(codeOf(() => usableAuthorization({ authorization: copy, now: NOW }))).toBe(
        "authorization_forged",
      );
    });
  });

  describe("when the expiry has passed", () => {
    /** @scenario "An expired proof is refused" */
    it("is refused as expired, at and after the instant", () => {
      const authorization = sealAuthorization(proof({ expiresAt: NOW }));
      expect(codeOf(() => usableAuthorization({ authorization, now: NOW }))).toBe(
        "authorization_expired",
      );
      expect(codeOf(() => usableAuthorization({ authorization, now: NOW + 1 }))).toBe(
        "authorization_expired",
      );
      expect(() => usableAuthorization({ authorization, now: NOW - 1 })).not.toThrow();
    });
  });

  describe("when the shape is wrong", () => {
    it("refuses to seal a proof with no grants, a shared grant without a condition, or an own grant with one", () => {
      expect(() => sealAuthorization(proof({ grants: [] }))).toThrow(/>=1/);
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
      ).toThrow(/a shared grant carries a condition/);
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
      ).toThrow(/an own grant carries none/);
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
      ).toThrow(/a shared grant names the project it reads/);
      const outsideTheVocabulary: unknown = { kind: "batch", route: "x" };
      expect(() =>
        sealAuthorization(
          proof({ purpose: outsideTheVocabulary as AuthorizationInput["purpose"] }),
        ),
      ).toThrow(/purpose/);
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
      const authorization = sealAuthorization(proof({ grants: [own, member, other] }));
      const narrowed = narrowAuthorization({ authorization, projectId: "proj_member" });

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

      expect(narrowAuthorization({ authorization, projectId: "proj_outsider" })).toBeNull();
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
      expect(narrowAuthorization({ authorization: narrowed, projectId: "proj_member" })).toBe(
        narrowed,
      );
    });

    it("refuses to narrow a proof assembled by hand", () => {
      const byHand = { ...sealAuthorization(proof()) } as Authorization;

      expect(
        codeOf(() => narrowAuthorization({ authorization: byHand, projectId: "proj_member" })),
      ).toBe("authorization_forged");
    });

    it("refuses a seal that names a project outside its grants", () => {
      expect(() => sealAuthorization({ ...proof(), narrowedTo: "proj_outsider" })).toThrow(
        /a narrowed proof names a project one of its grants reads/,
      );
    });
  });

  describe("when a test mints a proof through the helpers", () => {
    it("is sealed, so a store client accepts it", () => {
      const own = ownProof({ projectId: "proj_plain", now: NOW });
      const aggregate = aggregateProof({
        projectId: "proj_aggregate",
        members: [{ projectId: "proj_member", from: NOW - 1_000 }],
        now: NOW,
      });

      expect(usableAuthorization({ authorization: own, now: NOW })).toBe(own);
      expect(usableAuthorization({ authorization: aggregate, now: NOW })).toBe(aggregate);
      expect(aggregate.grants.map((grant) => grant.kind)).toEqual(["own", "shared"]);
    });
  });
});

describe("AccessNotGrantedError", () => {
  it("is a customer-side refusal naming the permission, whatever the cause", () => {
    const error = new AccessNotGrantedError({ permission: "traces:view" });

    expect(error).toMatchObject({
      code: "access_not_granted",
      httpStatus: 403,
      fault: "customer",
      meta: { permission: "traces:view" },
    });
  });
});
