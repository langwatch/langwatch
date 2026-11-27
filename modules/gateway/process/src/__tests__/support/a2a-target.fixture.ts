/** Builders the A2A target suites share: a target's inputs and the service over memory twins. */
import type { ProjectApi } from "@langwatch/project-contract";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";

import type { GatewayAuditRepository } from "../../repositories/gateway-audit.repository.ts";
import { MemoryGatewayA2aTargetRepository } from "../../repositories/memory/memory.gateway-a2a-target.repository.ts";
import { MemoryGatewayChangeEventsRepository } from "../../repositories/memory/memory.gateway-change-event.repository.ts";
import { GatewayA2aTargetService } from "../../services/gateway-a2a-target.service.ts";
import { memoryProjectWithTeam } from "./gateway-memory-seeds.fixture.ts";

export const a2aTargetBase = {
  organizationId: "org_1",
  agentName: "Billing agent",
  cardUrl: "https://billing.acme.test/.well-known/agent-card.json",
  upstreamUrl: "https://billing.acme.test/a2a",
  actorUserId: "user_1",
};

/** The one project this fixture's directory places in another organization. */
export const FOREIGN_PROJECT_ID = "p_other_org";

const noAudit: GatewayAuditRepository = { append: async () => {} };

/** Every project sits in `org_1`, except {@link FOREIGN_PROJECT_ID}. */
export function a2aTargetProjects(): ProjectApi {
  return createApiFixture<ProjectApi>({
    findWithTeam: async (projectId) =>
      memoryProjectWithTeam({
        projectId,
        teamId: `team_${projectId}`,
        organizationId: projectId === FOREIGN_PROJECT_ID ? "org_2" : a2aTargetBase.organizationId,
      }),
  });
}

export function a2aTargetService({
  changeEvents = MemoryGatewayChangeEventsRepository.create(),
  auditLog = noAudit,
  repository = MemoryGatewayA2aTargetRepository.create(),
  projects = a2aTargetProjects(),
}: {
  changeEvents?: MemoryGatewayChangeEventsRepository;
  auditLog?: GatewayAuditRepository;
  repository?: MemoryGatewayA2aTargetRepository;
  projects?: ProjectApi;
} = {}): GatewayA2aTargetService {
  return GatewayA2aTargetService.create({
    repository,
    changeEvents,
    auditLog,
    projects,
    transactions: { run: (work) => work({}) },
  });
}

/** A repository that fails the test once a read of every target asks to unseal their headers. */
export function sealedA2aTargetRepository(): MemoryGatewayA2aTargetRepository {
  const repository = MemoryGatewayA2aTargetRepository.create();
  const findAll = repository.findAll.bind(repository);
  repository.findAll = async (organizationId, options) => {
    if (options?.headers !== false) throw new Error("unsealed every target's headers");
    return findAll(organizationId, options);
  };
  return repository;
}
