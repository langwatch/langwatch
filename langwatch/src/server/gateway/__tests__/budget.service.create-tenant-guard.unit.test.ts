/**
 * @see specs/security/api-endpoint-authorization.feature
 *
 * The budget create() guards PRINCIPAL scope against cross-org targeting; this
 * covers the matching TEAM / PROJECT guard. organizationId is derived from the
 * authenticated caller's project, but the scope id is request-supplied, so a
 * caller could otherwise create a budget targeting another tenant's team or
 * project (the Team/Project FK is org-agnostic).
 */
import type { PrismaClient } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";

import { GatewayBudgetService } from "../budget.service";

const REACHED_TRANSACTION = "REACHED_TRANSACTION";

function mockPrisma(overrides: {
  team?: unknown;
  project?: unknown;
}): PrismaClient {
  return {
    organizationUser: { findFirst: vi.fn().mockResolvedValue(null) },
    team: { findFirst: vi.fn().mockResolvedValue(overrides.team ?? null) },
    project: { findFirst: vi.fn().mockResolvedValue(overrides.project ?? null) },
    // If control reaches here, the guard let the scope through.
    $transaction: vi.fn().mockRejectedValue(new Error(REACHED_TRANSACTION)),
  } as unknown as PrismaClient;
}

const baseInput = {
  organizationId: "org_caller",
  name: "Q budget",
  window: "MONTH" as never,
  limitUsd: 100,
  actorUserId: "user_1",
};

describe("GatewayBudgetService.create cross-org scope guard", () => {
  describe("when a TEAM-scoped budget targets a team in another organization", () => {
    /** @scenario "A team or project budget scoped to another organization is rejected" */
    it("rejects with a clear BAD_REQUEST", async () => {
      const sut = GatewayBudgetService.create(mockPrisma({ team: null }));
      await expect(
        sut.create({
          ...baseInput,
          scope: { kind: "TEAM", teamId: "team_other_org" },
        }),
      ).rejects.toThrow(/does not belong to this organization/);
    });
  });

  describe("when a PROJECT-scoped budget targets a project in another organization", () => {
    it("rejects with a clear BAD_REQUEST", async () => {
      const sut = GatewayBudgetService.create(mockPrisma({ project: null }));
      await expect(
        sut.create({
          ...baseInput,
          scope: { kind: "PROJECT", projectId: "project_other_org" },
        }),
      ).rejects.toThrow(/does not belong to this organization/);
    });
  });

  describe("when the TEAM belongs to the caller's organization", () => {
    it("passes the guard and proceeds to persist", async () => {
      const sut = GatewayBudgetService.create(mockPrisma({ team: { id: "team_ok" } }));
      await expect(
        sut.create({
          ...baseInput,
          scope: { kind: "TEAM", teamId: "team_ok" },
        }),
      ).rejects.toThrow(REACHED_TRANSACTION); // got past the guard
    });
  });
});
