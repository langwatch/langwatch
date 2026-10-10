/**
 * ADR-144 decision 9: which projects' privacy policies govern a read. The
 * proof is what the read actually sees, so the policies come from its
 * grants, never from the aggregate's rule.
 */
import { type Authorization, narrowAuthorization } from "@langwatch/actor";
import { describe, expect, it } from "vitest";
import { aggregateProof } from "~/test-utils/authorizationProofs";
import { policyProjectIdsOf } from "../policyProjectIdsOf";

const AGG = "proj_aggregate";
const A = "proj_member_a";
const B = "proj_member_b";

const proof = ({ shared }: { shared: string[] }): Authorization =>
  aggregateProof({
    projectId: AGG,
    members: shared.map((projectId) => ({ projectId, from: 0 })),
  });

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
