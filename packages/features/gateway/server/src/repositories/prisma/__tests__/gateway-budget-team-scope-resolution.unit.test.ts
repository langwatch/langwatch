import { describe, expect, it, vi } from "vitest";

import { PrismaGatewayBudgetResolutionRepository } from "../prisma.gateway-budget-resolution.repository";

/**
 * A team-scoped key's team used to be read only from where its traces land (the org's governance project for a multi-project key), so it reported the governance team and a budget on the key's own team matched nothing. Asserts on the query the resolver BUILDS, not on what the stub echoes back — the defect was an OR clause never naming the team, not a row failing to come back.
 */
function prismaStub({ teamScopeIds }: { teamScopeIds: string[] }) {
  const findMany = vi.fn().mockResolvedValue([]);
  // Exposed so a test can assert the key was NOT read. Without it, "never
  // reads the key" was a claim nothing checked.
  const scopeFindMany = vi.fn().mockResolvedValue(teamScopeIds.map((scopeId) => ({ scopeId })));
  return {
    client: {
      gatewayBudget: { findMany },
      groupMember: { findMany: vi.fn().mockResolvedValue([]) },
      group: { findMany: vi.fn().mockResolvedValue([]) },
      virtualKeyScope: { findMany: scopeFindMany },
    } as never,
    findMany,
    scopeFindMany,
  };
}

/**
 * Every TEAM clause in the built query, not just the first — a second clause would widen the match unnoticed, and an empty `{ in: [] }` matches nothing while reading as present.
 */
function teamClauses(findMany: ReturnType<typeof vi.fn>): unknown[] {
  const ors = findMany.mock.calls[0]?.[0]?.where?.OR ?? [];
  return ors.filter((clause: { scopeType?: string }) => clause.scopeType === "TEAM");
}

/** Every team id the built query would match a TEAM budget against. */
function teamIdsAsked(findMany: ReturnType<typeof vi.fn>): string[] {
  const ids = teamClauses(findMany).flatMap((clause) => {
    const scopeId = (clause as { scopeId?: string | { in?: string[] } }).scopeId;
    if (typeof scopeId === "string") return [scopeId];
    return scopeId?.in ?? [];
  });
  return [...new Set(ids)];
}

describe("team-scope budget resolution", () => {
  describe("given a key whose traces land somewhere other than its own team", () => {
    /** @scenario A key belongs to the teams it is scoped to */
    it("asks for the scoped team as well as the traced one", async () => {
      const { client, findMany } = prismaStub({
        teamScopeIds: ["team_platform"],
      });

      await PrismaGatewayBudgetResolutionRepository.create().resolveApplicableBudgets({
        client: client,
        target: {
          organizationId: "org_1",
          virtualKeyId: "vk_1",
          teamId: "team_governance",
        },
      });

      const asked = teamIdsAsked(findMany);
      expect(asked).toContain("team_platform");
      expect(asked).toContain("team_governance");
    });

    it("asks for each team once when the traced team is also a scoped team", async () => {
      const { client, findMany } = prismaStub({
        teamScopeIds: ["team_platform"],
      });

      await PrismaGatewayBudgetResolutionRepository.create().resolveApplicableBudgets({
        client: client,
        target: {
          organizationId: "org_1",
          virtualKeyId: "vk_1",
          teamId: "team_platform",
        },
      });

      expect(teamClauses(findMany)).toHaveLength(1);
      expect(teamIdsAsked(findMany)).toEqual(["team_platform"]);
    });
  });

  describe("given a caller that already knows the key's scopes", () => {
    it("uses the scopes it was handed and never reads the key", async () => {
      const { client, findMany, scopeFindMany } = prismaStub({
        teamScopeIds: ["team_from_database"],
      });

      await PrismaGatewayBudgetResolutionRepository.create().resolveApplicableBudgets({
        client: client,
        target: {
          organizationId: "org_1",
          virtualKeyId: null,
          teamId: null,
          scopedTeamIds: ["team_from_draft"],
        },
      });

      expect(teamIdsAsked(findMany)).toEqual(["team_from_draft"]);
      expect(scopeFindMany).not.toHaveBeenCalled();
    });
  });

  describe("given no key and no scopes in context", () => {
    it("asks for no team at all rather than for an empty one", async () => {
      const { client, findMany } = prismaStub({ teamScopeIds: [] });

      await PrismaGatewayBudgetResolutionRepository.create().resolveApplicableBudgets({
        client: client,
        target: {
          organizationId: "org_1",
          virtualKeyId: null,
          teamId: null,
        },
      });

      // No clause at all, not a clause matching nothing: an empty `in` would
      // read as a team filter that is present and silently match no budget.
      expect(teamClauses(findMany)).toEqual([]);
    });
  });
});
