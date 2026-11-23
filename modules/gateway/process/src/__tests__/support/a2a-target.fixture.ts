/** Builders the A2A target suites share: a target's inputs and the service over memory twins. */
import type { GatewayAuditRepository } from "../../repositories/gateway-audit.repository.ts";
import { MemoryGatewayA2aTargetRepository } from "../../repositories/memory/memory.gateway-a2a-target.repository.ts";
import { MemoryGatewayChangeEventsRepository } from "../../repositories/memory/memory.gateway-change-event.repository.ts";
import { GatewayA2aTargetService } from "../../services/gateway-a2a-target.service.ts";

export const a2aTargetBase = {
  organizationId: "org_1",
  agentName: "Billing agent",
  cardUrl: "https://billing.acme.test/.well-known/agent-card.json",
  upstreamUrl: "https://billing.acme.test/a2a",
  actorUserId: "user_1",
};

const noAudit: GatewayAuditRepository = { append: async () => {} };

export function a2aTargetService({
  changeEvents = MemoryGatewayChangeEventsRepository.create(),
  auditLog = noAudit,
  repository = MemoryGatewayA2aTargetRepository.create(),
}: {
  changeEvents?: MemoryGatewayChangeEventsRepository;
  auditLog?: GatewayAuditRepository;
  repository?: MemoryGatewayA2aTargetRepository;
} = {}): GatewayA2aTargetService {
  return GatewayA2aTargetService.create({
    repository,
    changeEvents,
    auditLog,
    transactions: { run: (work) => work({}) },
  });
}

/** A repository that fails the test once anything asks it to unseal every target's headers. */
export function sealedA2aTargetRepository(): MemoryGatewayA2aTargetRepository {
  const repository = MemoryGatewayA2aTargetRepository.create();
  const findAll = repository.findAll.bind(repository);
  repository.findAll = async (organizationId, options) => {
    if (options?.headers !== false) throw new Error("unsealed every target's headers");
    return findAll(organizationId, options);
  };
  return repository;
}
