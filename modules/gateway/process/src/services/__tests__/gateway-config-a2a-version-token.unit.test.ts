/**
 * The config version token must fingerprint the same A2A slice the bundle
 * carries, or a 304 confirms a stale bundle. Covers
 * specs/ai-gateway/a2a-proxy.feature.
 */

import type { ModelProviderApi } from "@langwatch/model-provider-contract";
import type { ProjectApi } from "@langwatch/project-contract";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { describe, expect, it } from "vitest";

import { memoryProjectWithTeam } from "../../__tests__/support/gateway-memory-seeds.fixture.ts";
import { memoryGatewayService } from "../../__tests__/support/memory.gateway-service.ts";
import { virtualKeyRow } from "../../app/__tests__/gateway-virtual-key.fixture.ts";
import { MemoryGatewayA2aTargetRepository } from "../../repositories/memory/memory.gateway-a2a-target.repository.ts";
import { MemoryGatewayChangeEventsRepository } from "../../repositories/memory/memory.gateway-change-event.repository.ts";
import { MemoryGatewayScopeResolutionRepository } from "../../repositories/memory/memory.gateway-scope-resolution.repository.ts";
import { MemoryGatewayStore } from "../../repositories/memory/memory.gateway.store.ts";
import type { GatewayConfigAssembly } from "../../rules/gateway-config-wire.rules.ts";
import { GatewayA2aTargetService } from "../gateway-a2a-target.service.ts";
import { GatewayConfigMaterialiserService } from "../gateway-config-materialisation.service.ts";
import { GatewayScopeResolutionService } from "../gateway-scope-resolution.service.ts";

const notReached = (): never => {
  throw new Error("the version token reads only the key's token, trace project and targets");
};

const assembly: GatewayConfigAssembly = {
  versionToken: async () => "cfg-1",
  withTierFallthrough: notReached,
  findDeclaredModelsForProvider: notReached,
  buildCredentials: notReached,
};

/** A directory placing every project in the key's organization, as a target write checks. */
function projectsOf(organizationId: string): ProjectApi {
  return createApiFixture<ProjectApi>({
    findWithTeam: async (projectId) =>
      memoryProjectWithTeam({ projectId, teamId: `team_${projectId}`, organizationId }),
  });
}

describe("GatewayConfigMaterialiserService.versionToken", () => {
  describe("given a key whose trace project no longer resolves", () => {
    /** @scenario "the config version token reads the same A2A targets as the bundle" */
    it("fingerprints the A2A targets of the scope the bundle carries", async () => {
      const vk = { ...virtualKeyRow(), traceProjectId: "p_gone" };
      const target = {
        organizationId: vk.organizationId,
        agentName: "Billing agent",
        cardUrl: "https://billing.acme.test/.well-known/agent-card.json",
        upstreamUrl: "https://billing.acme.test/a2a",
        actorUserId: "user_1",
        name: "billing",
      };
      const a2aTargets = GatewayA2aTargetService.create({
        repository: MemoryGatewayA2aTargetRepository.create(),
        changeEvents: MemoryGatewayChangeEventsRepository.create(),
        auditLog: { append: async () => {} },
        projects: projectsOf(vk.organizationId),
        transactions: { run: (work) => work({}) },
      });
      await a2aTargets.create({ ...target, projectId: null });
      await a2aTargets.create({ ...target, projectId: "p_gone", agentName: "Shadowing agent" });
      const projects = createApiFixture<ProjectApi>({
        findTraceDestination: async () => null,
      });
      const store = MemoryGatewayStore.create();
      const materialiser = GatewayConfigMaterialiserService.create({
        scopeResolution: GatewayScopeResolutionService.create({
          repository: MemoryGatewayScopeResolutionRepository.create(store),
          platformProviders: createApiFixture<ModelProviderApi>(),
          projects,
        }),
        projects,
        chRepo: null,
        budgetDecisions: memoryGatewayService({ store, projects }).service,
        modelProviders: createApiFixture<ModelProviderApi>(),
        assembly,
        a2aTargets,
      });

      const bundleScope = {
        organizationId: vk.organizationId,
        projectId: null,
        virtualKeyId: vk.id,
      };
      expect(await materialiser.versionToken(vk)).toBe(
        `cfg-1.${await a2aTargets.bundleFingerprint(bundleScope)}`,
      );
    });
  });

  describe("given a key whose trace destination is a project its scopes do not reach", () => {
    async function tokenFor(
      scopes: { scopeType: "ORGANIZATION" | "TEAM" | "PROJECT"; scopeId: string }[],
    ) {
      const vk = { ...virtualKeyRow(), traceProjectId: "p_traces", scopes };
      const a2aTargets = GatewayA2aTargetService.create({
        repository: MemoryGatewayA2aTargetRepository.create(),
        changeEvents: MemoryGatewayChangeEventsRepository.create(),
        auditLog: { append: async () => {} },
        projects: projectsOf(vk.organizationId),
        transactions: { run: (work) => work({}) },
      });
      await a2aTargets.create({
        organizationId: vk.organizationId,
        projectId: "p_traces",
        name: "billing",
        agentName: "Billing agent",
        cardUrl: "https://billing.acme.test/.well-known/agent-card.json",
        upstreamUrl: "https://billing.acme.test/a2a",
        actorUserId: "user_1",
      });
      const projects = createApiFixture<ProjectApi>({
        findTraceDestination: async () => ({
          id: "p_traces",
          teamId: "team_traces",
          archivedAt: null,
          kind: "application",
        }),
      });
      const store = MemoryGatewayStore.create();
      const materialiser = GatewayConfigMaterialiserService.create({
        scopeResolution: GatewayScopeResolutionService.create({
          repository: MemoryGatewayScopeResolutionRepository.create(store),
          platformProviders: createApiFixture<ModelProviderApi>(),
          projects,
        }),
        projects,
        chRepo: null,
        budgetDecisions: memoryGatewayService({ store, projects }).service,
        modelProviders: createApiFixture<ModelProviderApi>(),
        assembly,
        a2aTargets,
      });
      return materialiser.versionToken(vk);
    }

    /** @scenario "a key reaches a project's targets through its own scopes, never its trace destination" */
    it("carries none of that project's targets", async () => {
      expect(await tokenFor([{ scopeType: "PROJECT", scopeId: "p_elsewhere" }])).toBe("cfg-1");
    });

    /** @scenario "a key reaches a project's targets through its own scopes, never its trace destination" */
    it("carries them once its project, team or organization scope reaches the project", async () => {
      for (const scope of [
        { scopeType: "PROJECT" as const, scopeId: "p_traces" },
        { scopeType: "TEAM" as const, scopeId: "team_traces" },
        { scopeType: "ORGANIZATION" as const, scopeId: virtualKeyRow().organizationId },
      ]) {
        expect(await tokenFor([scope])).not.toBe("cfg-1");
      }
    });
  });
});
