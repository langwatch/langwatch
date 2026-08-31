/**
 * @see specs/security/api-endpoint-authorization.feature
 *
 * The budget create() guards PRINCIPAL scope against cross-org targeting; this
 * covers the matching TEAM / PROJECT guard. organizationId is derived from the
 * authenticated caller's project, but the scope id is request-supplied, so a
 * caller could otherwise create a budget targeting another tenant's team or
 * project (the Team/Project FK is org-agnostic).
 */

import { describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "~/generated/prisma/client";

import { PrismaGatewayAdapter } from "@langwatch/gateway-server";

const REACHED_TRANSACTION = "REACHED_TRANSACTION";

function mockPrisma(overrides: { team?: unknown; project?: unknown }): PrismaClient {
  return {
    organizationUser: { findFirst: vi.fn().mockResolvedValue(null) },
    team: { findFirst: vi.fn().mockResolvedValue(overrides.team ?? null) },
    project: {
      findFirst: vi.fn().mockResolvedValue(overrides.project ?? null),
      findMany: vi.fn().mockResolvedValue([]),
    },
    // No active keys, which is the one shape the reach guard always lets
    // through: an organization is allowed to write budgets before it has
    // any keys, so this test still reaches the transaction on its own
    // question rather than being answered by a different guard.
    virtualKey: { findMany: vi.fn().mockResolvedValue([]) },
    groupMembership: { findMany: vi.fn().mockResolvedValue([]) },
    // If control reaches here, the guard let the scope through.
    $transaction: vi.fn().mockRejectedValue(new Error(REACHED_TRANSACTION)),
  } as unknown as PrismaClient;
}

/**
 * The process's own composition, over the fake database.
 *
 * The two guards live one layer apart now: the TEAM check is
 * `PrismaGatewayBudgetRepository.create`'s, and the PROJECT check is the
 * service's, proved through the `ProjectService` it is built with. Composing
 * the pair the way `PrismaGatewayAdapter` composes it keeps both under test.
 */
function serviceOver(prisma: PrismaClient, project: unknown) {
  return PrismaGatewayAdapter.create({
    database: prisma,
    projects: {
      tryGetWithTeam: vi
        .fn()
        .mockResolvedValue(
          project
            ? { id: "project_ok", teamId: "team_ok", team: { organizationId: "org_caller" } }
            : null,
        ),
      listTraceDestinations: vi.fn().mockResolvedValue([]),
    } as never,
    evaluators: {} as never,
    monitors: {} as never,
    changes: {} as never,
    audit: {} as never,
  }).build();
}

const baseInput = {
  organizationId: "org_caller",
  name: "Q budget",
  window: "MONTH" as never,
  limitUsd: 100,
  actorUserId: "user_1",
};

describe("GatewayService.create cross-org scope guard", () => {
  describe("when a TEAM-scoped budget targets a team in another organization", () => {
    /** @scenario "A team or project budget scoped to another organization is rejected" */
    it("rejects with a clear BAD_REQUEST", async () => {
      const sut = serviceOver(mockPrisma({ team: null }), null);
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
      const sut = serviceOver(mockPrisma({ project: null }), null);
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
      const sut = serviceOver(mockPrisma({ team: { id: "team_ok" } }), null);
      await expect(
        sut.create({
          ...baseInput,
          scope: { kind: "TEAM", teamId: "team_ok" },
        }),
      ).rejects.toThrow(REACHED_TRANSACTION); // got past the guard
    });
  });
});
