/**
 * @vitest-environment node
 * The operator tasks over the gateway's own memory repositories.
 * Spec: modules/gateway/specs/gateway-operator-tasks.feature
 */
import { describe, expect, it } from "vitest";

import { MemoryGatewayRepositories } from "../../repositories/memory/memory.gateway.repositories.ts";
import { MemoryGatewayStore } from "../../repositories/memory/memory.gateway.store.ts";
import { reportTraceDestinationBackfill } from "../trace-destination-report.task.ts";
import { VirtualKeyConfigBackfillTask } from "../virtual-key-config-backfill.task.ts";

const ORG = "org_1";
const SIGNAL = new AbortController().signal;

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

  describe("given a key holding legacy aliases in its config", () => {
    const legacy = { modelAliases: { fast: "gpt-5-mini" }, keep: true };

    async function seededKey() {
      const world = gatewayHoldingKeys();
      await world.repositories.virtualKeys.create({
        ...keyInput({ id: "vk_legacy" }),
        config: legacy,
      });
      const task = VirtualKeyConfigBackfillTask.create({
        repository: () => world.repositories.virtualKeyConfigBackfill,
      });
      return { ...world, task };
    }

    /** @scenario "The operator tasks run over the gateway's own stores" */
    it("leaves the stored key as it was without --execute", async () => {
      const { repositories, task } = await seededKey();

      await task.run({ args: [], signal: SIGNAL });

      const key = await repositories.virtualKeys.findById({ id: "vk_legacy", organizationId: ORG });
      expect(key?.config).toEqual(legacy);
      expect(key?.routingPolicyId).toBeNull();
    });

    /** @scenario "The operator tasks run over the gateway's own stores" */
    it("mints the routing policy and strips the legacy keys with --execute", async () => {
      const { repositories, task } = await seededKey();

      await task.run({ args: ["--execute"], signal: SIGNAL });

      const key = await repositories.virtualKeys.findById({ id: "vk_legacy", organizationId: ORG });
      expect(key?.config).toEqual({ keep: true });
      expect(key?.routingPolicyId).toEqual(expect.any(String));
    });
  });
});
