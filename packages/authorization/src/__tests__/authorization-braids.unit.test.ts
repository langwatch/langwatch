import { describe, expect, it } from "vitest";
import { z } from "zod";

import {
  type AuthorizationInput,
  isSpanBraidGrant,
  narrowAuthorization,
  projectIdsReadBy,
  readScopeKeyOf,
  sealAuthorization,
  withoutSpanBraids,
} from "../index";

/**
 * ADR-183 §1, §3, §5: a proof carries a reader's braids as `span` grants with their compiled
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
  permissions: ["traces:view"],
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

    it("accepts a braid with no condition", () => {
      expect(() =>
        proof([own, braid({ where: undefined, compiledWhere: undefined })]),
      ).not.toThrow();
    });
  });

  describe("when it is narrowed to the reader's own project", () => {
    it("keeps the own grant and the braids", () => {
      const narrowed = narrowAuthorization({
        authorization: proof([own, braid()]),
        projectId: READER,
      });

      expect(narrowed?.narrowedTo).toBe(READER);
      expect(narrowed?.grants.map((grant) => grant.projectId)).toEqual([READER, OWNER]);
    });
  });

  describe("when it is narrowed to a braid's owner", () => {
    it("answers as not found, since a braid never opens the owner's trace", () => {
      expect(
        narrowAuthorization({ authorization: proof([own, braid()]), projectId: OWNER }),
      ).toBeNull();
    });
  });

  describe("when its braids are stripped", () => {
    it("keeps every grant but the braids, still sealed", () => {
      const stripped = withoutSpanBraids(proof([own, braid()]));

      expect(stripped.grants.map((grant) => grant.projectId)).toEqual([READER]);
      expect(narrowAuthorization({ authorization: stripped, projectId: READER })).not.toBeNull();
    });

    it("keeps the narrowing, so a narrowed proof stays on its project", () => {
      const narrowed = narrowAuthorization({
        authorization: proof([own, braid()]),
        projectId: READER,
      });

      expect(narrowed && withoutSpanBraids(narrowed).narrowedTo).toBe(READER);
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
      const key = readScopeKeyOf(proof([own, braid()]));
      const otherTree = readScopeKeyOf(
        proof([
          own,
          braid({
            compiledWhere: { ...compiledWhere, tree: { ...compiledWhere.tree, value: "cli" } },
          }),
        ]),
      );
      const otherVersion = readScopeKeyOf(
        proof([own, braid({ compiledWhere: { ...compiledWhere, version: 2 } })]),
      );

      expect(key).toMatch(new RegExp(`^${OWNER}@span:0-#[0-9a-f]{64},${READER}$`));
      expect(otherTree).not.toBe(key);
      expect(otherVersion).not.toBe(key);
      expect(readScopeKeyOf(proof([own, braid()]))).toBe(key);
    });

    it("keys a braid with no condition as a window alone, as before", () => {
      const key = readScopeKeyOf(
        proof([own, braid({ where: undefined, compiledWhere: undefined })]),
      );

      expect(key).toBe(`${OWNER}@span:0-,${READER}`);
    });

    it("keeps the braids in the key of a proof narrowed to its own project", () => {
      const narrowed = narrowAuthorization({
        authorization: proof([own, braid()]),
        projectId: READER,
      });

      expect(narrowed && readScopeKeyOf(narrowed)).toBe(readScopeKeyOf(proof([own, braid()])));
    });
  });
});
