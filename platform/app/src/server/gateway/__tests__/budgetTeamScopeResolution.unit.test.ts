import { describe, expect, it, vi } from "vitest";

import { resolveApplicableBudgets } from "../budgetResolution.service";

/**
 * The team a request belongs to used to be read only from where its traces
 * land, which for a key that is not scoped to exactly one project is the
 * organization's governance project. A team-scoped key therefore reported
 * the governance team, and a budget on the team that owns the key matched
 * nothing.
 *
 * These assert on the query the resolver builds rather than on what the
 * stub echoes back, because the whole defect was an OR clause that never
 * named the team, not a row that failed to come back.
 */
function prismaStub(teamScopeIds: string[]) {
  const findMany = vi.fn().mockResolvedValue([]);
  return {
    client: {
      gatewayBudget: { findMany },
      groupMember: { findMany: vi.fn().mockResolvedValue([]) },
      group: { findMany: vi.fn().mockResolvedValue([]) },
      virtualKeyScope: {
        findMany: vi
          .fn()
          .mockResolvedValue(teamScopeIds.map((scopeId) => ({ scopeId }))),
      },
    } as never,
    findMany,
  };
}

/** Every team id the built query would match a TEAM budget against. */
function teamIdsAsked(findMany: ReturnType<typeof vi.fn>): string[] {
  const ors = findMany.mock.calls[0]?.[0]?.where?.OR ?? [];
  const teamClause = ors.find(
    (clause: { scopeType?: string }) => clause.scopeType === "TEAM",
  );
  if (!teamClause) return [];
  const scopeId = teamClause.scopeId;
  return typeof scopeId === "string" ? [scopeId] : (scopeId?.in ?? []);
}

describe("team-scope budget resolution", () => {
  describe("given a key whose traces land somewhere other than its own team", () => {
    /** @scenario A key belongs to the teams it is scoped to */
    it("asks for the scoped team as well as the traced one", async () => {
      const { client, findMany } = prismaStub(["team_platform"]);

      await resolveApplicableBudgets(client, {
        organizationId: "org_1",
        virtualKeyId: "vk_1",
        teamId: "team_governance",
      });

      const asked = teamIdsAsked(findMany);
      expect(asked).toContain("team_platform");
      expect(asked).toContain("team_governance");
    });

    it("asks for each team once when the traced team is also a scoped team", async () => {
      const { client, findMany } = prismaStub(["team_platform"]);

      await resolveApplicableBudgets(client, {
        organizationId: "org_1",
        virtualKeyId: "vk_1",
        teamId: "team_platform",
      });

      expect(teamIdsAsked(findMany)).toEqual(["team_platform"]);
    });
  });

  describe("when the caller already knows the key's scopes", () => {
    it("uses the scopes it was handed and never reads the key", async () => {
      const { client, findMany } = prismaStub(["team_from_database"]);

      await resolveApplicableBudgets(client, {
        organizationId: "org_1",
        virtualKeyId: null,
        teamId: null,
        scopedTeamIds: ["team_from_draft"],
      });

      expect(teamIdsAsked(findMany)).toEqual(["team_from_draft"]);
    });
  });

  describe("when there is no key and no scopes in context", () => {
    it("asks for no team at all rather than for an empty one", async () => {
      const { client, findMany } = prismaStub([]);

      await resolveApplicableBudgets(client, {
        organizationId: "org_1",
        virtualKeyId: null,
        teamId: null,
      });

      expect(teamIdsAsked(findMany)).toEqual([]);
    });
  });
});
