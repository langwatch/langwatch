/**
 * @vitest-environment node
 * The operator tasks over the gateway's own memory repositories.
 * Spec: modules/gateway/specs/gateway-operator-tasks.feature
 */
import { describe, expect, it } from "vitest";

import { MemoryGatewayRepositories } from "../../repositories/memory/memory.gateway.repositories.ts";
import { MemoryGatewayStore } from "../../repositories/memory/memory.gateway.store.ts";
import { reportTraceDestinationBackfill } from "../trace-destination-report.task.ts";

const ORG = "org_1";

function gatewayHoldingKeys() {
  const store = MemoryGatewayStore.create({
    organizations: [
      { id: ORG, name: "Acme", slug: "acme" },
      { id: "org_bare", name: "Bare", slug: "bare" },
    ],
    teams: [{ id: "team_1", organizationId: ORG, name: "One", slug: "one" }],
    projects: [
      { id: "project_live", teamId: "team_1" },
      { id: "project_governance", teamId: "team_1", kind: "internal_governance" },
    ],
  });
  const repositories = new MemoryGatewayRepositories(store).repositories;
  return { store, repositories };
}

function keyInput(overrides: { id: string; organizationId?: string; traceProjectId?: string }) {
  return {
    id: overrides.id,
    organizationId: overrides.organizationId ?? ORG,
    name: overrides.id,
    hashedSecret: `hash_${overrides.id}`,
    displayPrefix: "lw_vk_",
    config: {},
    createdById: "usr_1",
    scopes: [{ scopeType: "PROJECT" as const, scopeId: "project_live" }],
    ...(overrides.traceProjectId === undefined ? {} : { traceProjectId: overrides.traceProjectId }),
  };
}

describe("the gateway's operator tasks over its own stores", () => {
  describe("given keys and projects held by the gateway's stores", () => {
    /** @scenario "The operator tasks run over the gateway's own stores" */
    it("reports each key under the rule that would answer for it", async () => {
      const { repositories } = gatewayHoldingKeys();
      await repositories.virtualKeys.create(
        keyInput({ id: "vk_a", traceProjectId: "project_live" }),
      );
      await repositories.virtualKeys.create(
        keyInput({ id: "vk_b", traceProjectId: "project_gone" }),
      );
      await repositories.virtualKeys.create(
        keyInput({ id: "vk_c", organizationId: "org_bare", traceProjectId: "project_gone" }),
      );

      const report = await reportTraceDestinationBackfill({
        repository: repositories.traceDestinationReport,
      });

      expect(report.counts).toMatchObject({
        "explicit-live": 1,
        "explicit-missing": 1,
        null: 1,
      });
      expect(report.organizationsWithDestinationlessKeys).toEqual(["org_bare"]);
      expect(report.organizationsWithoutGovernanceProject).toBe(1);
    });
  });
});
