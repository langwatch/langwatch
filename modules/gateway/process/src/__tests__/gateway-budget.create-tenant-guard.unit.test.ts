/**
 * @see specs/security/api-endpoint-authorization.feature
 * Covers the TEAM/PROJECT cross-org guard on create(): scopeId is request-supplied and the
 * Team/Project FK is org-agnostic, so a caller could otherwise target another tenant's rows.
 */

import type { ProjectApi } from "@langwatch/project-contract";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { describe, expect, it } from "vitest";

import { MemoryGatewayStore } from "../repositories/memory/memory.gateway.store.ts";
import { memoryProjectWithTeam } from "./support/gateway-memory-seeds.fixture.ts";
import { memoryGatewayService } from "./support/memory.gateway-service.ts";

/** The TEAM guard lives in the budget repository's create(); PROJECT lives in the service. */
function serviceOver() {
  const store = MemoryGatewayStore.create({
    teams: [
      { id: "team_ok", organizationId: "org_caller", name: "Ours", slug: "ours" },
      { id: "team_other_org", organizationId: "org_other", name: "Theirs", slug: "theirs" },
    ],
  });
  const { service } = memoryGatewayService({
    store,
    projects: createApiFixture<ProjectApi>({
      findWithTeam: async (id) =>
        id === "project_other_org"
          ? memoryProjectWithTeam({
              projectId: id,
              teamId: "team_other_org",
              organizationId: "org_other",
            })
          : null,
      // No active keys, the one shape the reach guard always lets through, so a
      // TEAM budget answers this guard's question rather than a later one's.
      listTraceDestinations: async () => [],
    }),
  });
  return { service, store };
}

const baseInput = {
  organizationId: "org_caller",
  name: "Q budget",
  window: "MONTH" as const,
  limitUsd: 100,
  actorUserId: "user_1",
};

describe("GatewayService.create cross-org scope guard", () => {
  describe("when a TEAM-scoped budget targets a team in another organization", () => {
    /** @scenario "A team or project budget scoped to another organization is rejected" */
    it("rejects it as a scope outside the organization", async () => {
      const { service, store } = serviceOver();
      await expect(
        service.create({
          ...baseInput,
          scope: { kind: "TEAM", teamId: "team_other_org" },
        }),
      ).rejects.toMatchObject({ code: "gateway_scope_org_mismatch", httpStatus: 400 });
      expect(store.budgets.size).toBe(0);
    });
  });

  describe("when a PROJECT-scoped budget targets a project in another organization", () => {
    it("rejects it as a scope outside the organization", async () => {
      const { service, store } = serviceOver();
      await expect(
        service.create({
          ...baseInput,
          scope: { kind: "PROJECT", projectId: "project_other_org" },
        }),
      ).rejects.toMatchObject({ code: "gateway_scope_org_mismatch", httpStatus: 400 });
      expect(store.budgets.size).toBe(0);
    });
  });

  describe("when the TEAM belongs to the caller's organization", () => {
    it("passes the guard and persists the budget", async () => {
      const { service, store } = serviceOver();
      const created = await service.create({
        ...baseInput,
        scope: { kind: "TEAM", teamId: "team_ok" },
      });

      expect(created).toMatchObject({
        organizationId: "org_caller",
        scopeType: "TEAM",
        scopeId: "team_ok",
      });
      expect(store.budgets.has(created.id)).toBe(true);
    });
  });
});
