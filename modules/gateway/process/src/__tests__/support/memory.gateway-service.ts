import type { EvaluatorApi } from "@langwatch/evaluator-contract";
import type { MonitorApi } from "@langwatch/monitor-contract";
import type { OrganizationApi } from "@langwatch/organization-contract";
import type { ProjectApi } from "@langwatch/project-contract";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";

import type { GatewayRepositories } from "../../repositories/gateway.repositories.ts";
import { MemoryGatewayRepositories } from "../../repositories/memory/memory.gateway.repositories.ts";
import type { MemoryGatewayStore } from "../../repositories/memory/memory.gateway.store.ts";
import { GatewayCacheRuleService } from "../../services/gateway-cache-rule.service.ts";
import { GatewayGuardrailService } from "../../services/gateway-guardrail.service.ts";
import { GatewayService, type GatewayBudgetOrganizations } from "../../services/gateway.service.ts";

/**
 * Gateway's budget service over the memory registry, composed as gateway.app.ts composes it.
 * The repositories come back too, so a test seeds the ledger through the twin the service reads.
 */
export function memoryGatewayService({
  store,
  projects,
  organizations = createApiFixture<OrganizationApi>({ listGroupsForMember: async () => [] }),
}: {
  store: MemoryGatewayStore;
  projects: ProjectApi;
  organizations?: GatewayBudgetOrganizations;
}): { service: GatewayService; repositories: GatewayRepositories } {
  const { repositories } = new MemoryGatewayRepositories(store);
  const service = GatewayService.create({
    repository: repositories.budgets,
    projects,
    organizations,
    cacheRules: GatewayCacheRuleService.create(repositories.cacheRules),
    guardrails: GatewayGuardrailService.create({
      repository: repositories.guardrails,
      evaluators: createApiFixture<EvaluatorApi>({}),
      monitors: createApiFixture<MonitorApi>({}),
      projects,
      audit: repositories.audit,
    }),
  });
  return { service, repositories };
}
