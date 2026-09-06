import type { AgentsAuditLogPort, AgentsDatabase, AgentsWorkflowPort } from "../ports/agent.port.ts";
import { PrismaAgentRepository } from "../repositories/prisma/prisma.agent.repository.ts";
import { AgentService } from "../services/agent.service.ts";

export type PrismaAgentAdapterOptions = {
  database: AgentsDatabase;
  workflows: AgentsWorkflowPort;
  auditLog: AgentsAuditLogPort;
  generateId?: () => string;
};

/** Binds the private Prisma repository to the portable Agent service. */
export class PrismaAgentAdapter {
  static create(options: PrismaAgentAdapterOptions): AgentService {
    return AgentService.create({
      repository: PrismaAgentRepository.create(options.database),
      workflows: options.workflows,
      auditLog: options.auditLog,
      generateId: options.generateId,
    });
  }
}
