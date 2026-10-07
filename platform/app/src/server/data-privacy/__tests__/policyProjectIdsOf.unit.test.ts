/**
 * ADR-144 decision 9: which projects' privacy policies govern a read. The
 * proof is what the read actually sees, so the policies come from its
 * grants, never from the aggregate's rule.
 */
import {
  type Authorization,
  narrowAuthorization,
  sealAuthorization,
} from "@langwatch/actor";
import { describe, expect, it } from "vitest";
import { policyProjectIdsOf } from "../policyProjectIdsOf";

const AGG = "proj_aggregate";
const A = "proj_member_a";
const B = "proj_member_b";

function proof({ shared }: { shared: string[] }): Authorization {
  return sealAuthorization({
    actor: { type: "user", id: "ana" },
    principal: { type: "user", id: "ana" },
    scope: { organizationId: "org_acme" },
    grants: [
      {
        projectId: AGG,
        permissions: ["traces:view"],
        via: [],
        kind: "own",
      },
      ...shared.map((projectId) => ({
        projectId,
        permissions: ["traces:view"],
        via: [`grant_${projectId}`],
        kind: "shared" as const,
        condition: { type: "trace" as const, from: 0, until: null },
      })),
    ],
    expiresAt: Date.now() + 60_000,
    purpose: { kind: "route", route: "tracesV2.list" },
  });
}

describe("policyProjectIdsOf", () => {
  describe("when the read carries no proof", () => {
    it("is governed by the shown project alone", () => {
      expect(policyProjectIdsOf({ projectId: AGG })).toEqual([AGG]);
    });
  });

  describe("when the proof holds only its own grant", () => {
    it("is governed by the own project alone", () => {
      expect(
        policyProjectIdsOf({
          projectId: AGG,
          authorization: proof({ shared: [] }),
        }),
      ).toEqual([AGG]);
    });
  });

  describe("when the proof reads an aggregate's members", () => {
    it("is governed by the own project and every member it reads", () => {
      expect(
        policyProjectIdsOf({
          projectId: AGG,
          authorization: proof({ shared: [A, B] }),
        }),
      ).toEqual([AGG, A, B]);
    });
  });

  describe("when the proof is narrowed to one member", () => {
    it("is governed by the own project and that member only", () => {
      const narrowed = narrowAuthorization({
        authorization: proof({ shared: [A, B] }),
        projectId: A,
      });
      if (!narrowed) throw new Error("narrowing to a named member failed");

      expect(
        policyProjectIdsOf({ projectId: AGG, authorization: narrowed }),
      ).toEqual([AGG, A]);
    });
  });

  describe("when the proof was minted for another project", () => {
    it("ignores the proof and is governed by the shown project", () => {
      expect(
        policyProjectIdsOf({
          projectId: "proj_elsewhere",
          authorization: proof({ shared: [A] }),
        }),
      ).toEqual(["proj_elsewhere"]);
    });
  });
});
