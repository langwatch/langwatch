import { describe, expect, it } from "vitest";
import { z } from "zod";

import {
  AccessNotGrantedError,
  type AuthorizationInput,
  BRAID_CONDITION_EVERY_SPAN,
  honourSpanBraids,
  honouredSpanBraidGrants,
  isSpanBraidGrant,
  narrowAuthorization,
  projectIdsReadBy,
  readScopeKeyOf,
  sealAuthorization,
  SPAN_BRAID_PERMISSION,
  withoutSpanBraids,
} from "../index";

/**
 * ADR-201 §1, §3, §5: a proof carries a reader's braids as `span` grants with their compiled
 * condition; narrowing keeps them for the reader's own traces and never opens an owner's trace.
 */

const NOW = 1_760_000_000_000;
const READER = "proj_reader";
const OWNER = "proj_owner";

const compiledWhere = {
  version: 1,
  tree: {
    kind: "attributeEquals" as const,
    on: "span" as const,
    key: "orchestrator",
    value: "web",
  },
};

type GrantInput = AuthorizationInput["grants"][number];

const own: GrantInput = {
  projectId: READER,
  permissions: ["traces:view"],
  via: [],
  kind: "own",
};

const braid = (condition: Partial<NonNullable<GrantInput["condition"]>> = {}): GrantInput => ({
  projectId: OWNER,
  permissions: [SPAN_BRAID_PERMISSION],
  via: ["grant_braid"],
  kind: "shared",
  condition: {
    type: "span",
    where: 'attributes["orchestrator"] == "web"',
    compiledWhere,
    from: 0,
    until: null,
    ...condition,
  },
});

const proof = (grants: GrantInput[]) =>
  sealAuthorization({
    actor: { type: "user", id: "user_ana" },
    principal: { type: "user", id: "user_ana" },
    scope: { organizationId: "org_acme" },
    grants,
    expiresAt: NOW + 30_000,
    purpose: { kind: "route", route: "traces.get" },
  });

/** The proof as the trace module's Enterprise plan check hands it on. */
const honoured = (grants: GrantInput[]) => honourSpanBraids({ authorization: proof(grants) });

describe("a proof carrying braids", () => {
  describe("when it is sealed", () => {
    it("accepts a span grant with its compiled condition", () => {
      const sealed = proof([own, braid()]);

      expect(sealed.grants.filter(isSpanBraidGrant).map((grant) => grant.projectId)).toEqual([
        OWNER,
      ]);
    });

    it("refuses a compiled condition on a trace window, which no fence would apply", () => {
      expect(() => proof([own, braid({ type: "trace" })])).toThrow(z.ZodError);
    });

    it("refuses a span condition whose where was never compiled", () => {
      expect(() => proof([own, braid({ compiledWhere: undefined })])).toThrow(z.ZodError);
    });

    /** @scenario "A span condition always carries its compiled form" */
    it("refuses a span condition with no compiled form, even with no where", () => {
      expect(() => proof([own, braid({ where: undefined, compiledWhere: undefined })])).toThrow(
        z.ZodError,
      );
    });

    /** @scenario "A span condition always carries its compiled form" */
    it("accepts a braid with no condition only as every span, stated", () => {
      const sealed = proof([
        own,
        braid({ where: undefined, compiledWhere: BRAID_CONDITION_EVERY_SPAN }),
      ]);

      expect(sealed.grants[1]?.condition?.compiledWhere).toEqual(BRAID_CONDITION_EVERY_SPAN);
    });

    /** @scenario "A minted braid grant carries only the braid permission" */
    it("refuses a braid grant carrying any permission but the braid one", () => {
      for (const permissions of [["traces:view"], [SPAN_BRAID_PERMISSION, "traces:view"], []]) {
        expect(() => proof([own, { ...braid(), permissions }]), permissions.join()).toThrow(
          z.ZodError,
        );
      }
    });

    /** @scenario "A minted braid grant carries only the braid permission" */
    it("refuses the braid permission on any grant but a braid", () => {
      const trace: GrantInput = {
        projectId: OWNER,
        permissions: ["traces:view", SPAN_BRAID_PERMISSION],
        via: ["grant_trace"],
        kind: "shared",
        condition: { type: "trace", from: 0, until: null },
      };

      expect(() =>
        proof([{ ...own, permissions: ["traces:view", SPAN_BRAID_PERMISSION] }]),
      ).toThrow(z.ZodError);
      expect(() => proof([own, trace])).toThrow(z.ZodError);
    });
  });

  describe("when it is narrowed to the reader's own project", () => {
    it("keeps the own grant and the braids", () => {
      const narrowed = narrowAuthorization({
        authorization: proof([own, braid()]),
        projectId: READER,
      });

      expect(narrowed.narrowedTo).toBe(READER);
      expect(narrowed.grants.map((grant) => grant.projectId)).toEqual([READER, OWNER]);
    });
  });

  describe("when it is narrowed to a braid's owner", () => {
    /** @scenario "A proof that cannot be narrowed to a project is refused, never read whole" */
    it("refuses, since a braid never opens the owner's trace and the whole proof is never read", () => {
      expect(() =>
        narrowAuthorization({ authorization: proof([own, braid()]), projectId: OWNER }),
      ).toThrow(AccessNotGrantedError);
    });
  });

  describe("when its braids are stripped", () => {
    it("keeps every grant but the braids, still sealed", () => {
      const stripped = withoutSpanBraids(proof([own, braid()]));

      expect(stripped.grants.map((grant) => grant.projectId)).toEqual([READER]);
      expect(narrowAuthorization({ authorization: stripped, projectId: READER }).narrowedTo).toBe(
        READER,
      );
    });

    it("keeps the narrowing, so a narrowed proof stays on its project", () => {
      const narrowed = narrowAuthorization({
        authorization: proof([own, braid()]),
        projectId: READER,
      });

      expect(withoutSpanBraids(narrowed).narrowedTo).toBe(READER);
    });

    it("returns a proof with no braids as it is", () => {
      const plain = proof([own]);

      expect(withoutSpanBraids(plain)).toBe(plain);
    });

    it("refuses a forged proof", () => {
      const forged = { ...proof([own, braid()]) };

      expect(() => withoutSpanBraids(forged)).toThrow(
        expect.objectContaining({ code: "authorization_forged" }),
      );
    });
  });

  describe("when the projects it reads traces in are asked for", () => {
    it("leaves the braid's owner out", () => {
      expect(projectIdsReadBy(proof([own, braid()]))).toEqual([READER]);
    });
  });

  describe("when a cache key is taken", () => {
    it("carries the condition's digest, so a changed tree or compiler version keys apart", () => {
      const key = readScopeKeyOf(honoured([own, braid()]));
      const otherTree = readScopeKeyOf(
        honoured([
          own,
          braid({
            compiledWhere: { ...compiledWhere, tree: { ...compiledWhere.tree, value: "cli" } },
          }),
        ]),
      );
      const otherVersion = readScopeKeyOf(
        honoured([own, braid({ compiledWhere: { ...compiledWhere, version: 2 } })]),
      );

      expect(key).toMatch(new RegExp(`^${OWNER}@span:0-#[0-9a-f]{64},${READER}$`));
      expect(otherTree).not.toBe(key);
      expect(otherVersion).not.toBe(key);
      expect(readScopeKeyOf(honoured([own, braid()]))).toBe(key);
    });

    it("keys a braid with no condition by the every-span form's digest", () => {
      const key = readScopeKeyOf(
        honoured([own, braid({ where: undefined, compiledWhere: BRAID_CONDITION_EVERY_SPAN })]),
      );

      expect(key).toMatch(new RegExp(`^${OWNER}@span:0-#[0-9a-f]{64},${READER}$`));
      expect(key).not.toBe(readScopeKeyOf(honoured([own, braid()])));
    });

    it("keys an honoured braid whichever permission the read asks, never under-keying", () => {
      const analytics: GrantInput = { ...own, permissions: ["traces:view", "analytics:view"] };
      const withBraid = honoured([analytics, braid()]);

      expect(readScopeKeyOf(withBraid, "analytics:view")).not.toBe(
        readScopeKeyOf(proof([analytics]), "analytics:view"),
      );
      expect(readScopeKeyOf(withBraid)).toContain(`${OWNER}@span`);
    });

    it("keeps the braids in the key of a proof narrowed to its own project", () => {
      const narrowed = narrowAuthorization({
        authorization: honoured([own, braid()]),
        projectId: READER,
      });

      expect(readScopeKeyOf(narrowed)).toBe(readScopeKeyOf(honoured([own, braid()])));
    });

    it("keys a proof whose braids were never honoured as one without them", () => {
      expect(readScopeKeyOf(proof([own, braid()]))).toBe(readScopeKeyOf(proof([own])));
    });
  });

  describe("when its braids are honoured", () => {
    it("is unhonoured as minted, so its braids reach no fence", () => {
      const minted = proof([own, braid()]);

      expect(minted.braidsHonoured).toBeUndefined();
      expect(honouredSpanBraidGrants(minted)).toEqual([]);
    });

    it("returns a sealed proof whose braids reach the fence", () => {
      const sealed = honoured([own, braid()]);

      expect(sealed.braidsHonoured).toBe(true);
      expect(honouredSpanBraidGrants(sealed).map((grant) => grant.projectId)).toEqual([OWNER]);
      expect(narrowAuthorization({ authorization: sealed, projectId: READER })).not.toBeNull();
    });

    /** @scenario "Resealing a proof with other grants drops the honoured flag" */
    it("drops the flag when the proof is sealed again, its grants swapped or not", () => {
      const done = honoured([own, braid()]);
      const swapped = sealAuthorization({
        ...done,
        grants: [own, braid({ compiledWhere: BRAID_CONDITION_EVERY_SPAN, where: undefined })],
      });
      const resealed = sealAuthorization({ ...done });

      for (const sealed of [swapped, resealed]) {
        expect(sealed.braidsHonoured).toBeUndefined();
        expect(honouredSpanBraidGrants(sealed)).toEqual([]);
      }
      expect(honourSpanBraids({ authorization: swapped }).braidsHonoured).toBe(true);
    });

    /** @scenario "Resealing a proof with other grants drops the honoured flag" */
    it("keeps the flag through narrowing to the reader's own project", () => {
      const narrowed = narrowAuthorization({
        authorization: honoured([own, braid()]),
        projectId: READER,
      });

      expect(narrowed?.braidsHonoured).toBe(true);
    });

    it("returns a proof with no braids, or one already honoured, as it is", () => {
      const plain = proof([own]);
      const done = honoured([own, braid()]);

      expect(honourSpanBraids({ authorization: plain })).toBe(plain);
      expect(honourSpanBraids({ authorization: done })).toBe(done);
    });

    it("refuses a forged proof", () => {
      const forged = { ...proof([own, braid()]) };

      expect(() => honourSpanBraids({ authorization: forged })).toThrow(
        expect.objectContaining({ code: "authorization_forged" }),
      );
    });
  });
});
