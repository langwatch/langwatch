import type { Agent, PrismaClient } from "@prisma/client";
import { AgentRepository, type CreateAgentInput } from "./agent.repository";

/**
 * Service layer for Agent business logic.
 * Single Responsibility: Agent lifecycle management.
 *
 * Framework-agnostic - no tRPC dependencies.
 */
export class AgentService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly repository: AgentRepository,
  ) {}

  /**
   * Static factory method for creating an AgentService with proper DI.
   */
  static create(prisma: PrismaClient): AgentService {
    const repository = new AgentRepository(prisma);
    return new AgentService(prisma, repository);
  }

  /**
   * Gets an agent by ID.
   */
  get getById() {
    return this.repository.findById.bind(this.repository);
  }

  /**
   * Gets all agents for a project.
   */
  get getAll() {
    return this.repository.findAll.bind(this.repository);
  }

  /**
   * Creates a new agent.
   */
  get create() {
    return this.repository.create.bind(this.repository);
  }

  /**
   * Updates an existing agent.
   */
  get update() {
    return this.repository.update.bind(this.repository);
  }

  /**
   * Soft deletes an agent.
   */
  get softDelete() {
    return this.repository.softDelete.bind(this.repository);
  }
}
