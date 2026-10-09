/** ADR-177 decision 9: the policies come from the proof's grants, never the aggregate's rule. */
import {
  type Authorization,
  narrowAuthorization,
  sealAuthorization,
} from "@langwatch/authorization";
import { describe, expect, it } from "vitest";

import { policyProjectIdsOf } from "../policy-project-ids.rules.ts";

const AGG = "proj_aggregate";
const A = "proj_member_a";
const B = "proj_member_b";

const proof = ({ shared }: { shared: string[] }): Authorization =>
  sealAuthorization({
    actor: { type: "user", id: "test-user" },
    principal: { type: "user", id: "test-user" },
    scope: { organizationId: "test-organization" },
    grants: [
      { projectId: AGG, permissions: ["traces:view"], via: [], kind: "own" },
      ...shared.map((projectId, index) => ({
        projectId,
        permissions: ["traces:view" as const],
        via: [`grant_${index}`],
        kind: "shared" as const,
        condition: { type: "trace" as const, from: 0, until: null },
      })),
    ],
    expiresAt: Date.now() + 60_000,
    purpose: { kind: "route", route: "test" },
  });

describe("policyProjectIdsOf", () => {
  describe("when the read carries no proof", () => {
    it("is governed by the shown project alone", () => {
      expect(policyProjectIdsOf({ projectId: AGG })).toEqual([AGG]);
    });
  });

  describe("when the proof holds only its own grant", () => {
    it("is governed by the own project alone", () => {
      expect(policyProjectIdsOf({ projectId: AGG, authorization: proof({ shared: [] }) })).toEqual([
        AGG,
      ]);
    });
  });

  describe("when the proof reads an aggregate's members", () => {
    it("is governed by the own project and every member it reads", () => {
      expect(
        policyProjectIdsOf({ projectId: AGG, authorization: proof({ shared: [A, B] }) }),
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

      expect(policyProjectIdsOf({ projectId: AGG, authorization: narrowed })).toEqual([AGG, A]);
    });
  });

  describe("when the proof was minted for another project", () => {
    it("ignores the proof and is governed by the shown project", () => {
      expect(
        policyProjectIdsOf({ projectId: "proj_elsewhere", authorization: proof({ shared: [A] }) }),
      ).toEqual(["proj_elsewhere"]);
    });
  });
});
