import {
  createGatewayA2aTargetInputSchema,
  updateGatewayA2aTargetInputSchema,
  type CreateGatewayA2aTargetInput,
  type GatewayA2aTargetResource,
  type GatewayA2aTargetWire,
  type UpdateGatewayA2aTargetInput,
} from "@langwatch/gateway-contract";

import type { GatewayA2aTargetRepository } from "../repositories/gateway-a2a-target.repository.ts";
import { a2aTargetsForProject } from "../rules/gateway-a2a-target.rules.ts";

export class GatewayA2aTargetNotFoundError extends Error {
  constructor() {
    super("A2A target not found");
    this.name = "GatewayA2aTargetNotFoundError";
  }
}

export class GatewayA2aTargetNameTakenError extends Error {
  constructor(name: string) {
    super(`An A2A target named "${name}" already exists in this scope`);
    this.name = "GatewayA2aTargetNameTakenError";
  }
}

/** The A2A target registry: one name per scope (org-wide or one project). */
export class GatewayA2aTargetService {
  static create(repository: GatewayA2aTargetRepository): GatewayA2aTargetService {
    return new GatewayA2aTargetService(repository);
  }

  private constructor(private readonly repository: GatewayA2aTargetRepository) {}

  list(organizationId: string): Promise<GatewayA2aTargetResource[]> {
    return this.repository.findAll(organizationId);
  }

  async create(input: CreateGatewayA2aTargetInput): Promise<GatewayA2aTargetResource> {
    const parsed = createGatewayA2aTargetInputSchema.parse(input);
    const existing = await this.repository.findAll(parsed.organizationId);
    if (existing.some((t) => t.name === parsed.name && t.projectId === parsed.projectId)) {
      throw new GatewayA2aTargetNameTakenError(parsed.name);
    }
    return this.repository.create(parsed);
  }

  async update(input: UpdateGatewayA2aTargetInput): Promise<GatewayA2aTargetResource> {
    const parsed = updateGatewayA2aTargetInputSchema.parse(input);
    if (!(await this.repository.findById(parsed))) throw new GatewayA2aTargetNotFoundError();
    return this.repository.update(parsed);
  }

  async archive(input: { id: string; organizationId: string }): Promise<GatewayA2aTargetResource> {
    if (!(await this.repository.findById(input))) throw new GatewayA2aTargetNotFoundError();
    return this.repository.archive(input);
  }

  /** The bundle's `a2a_targets` for a key whose traffic belongs to `projectId`. */
  async bundleFor(input: {
    organizationId: string;
    projectId: string | null;
  }): Promise<GatewayA2aTargetWire[]> {
    const targets = await this.repository.findAll(input.organizationId);
    return a2aTargetsForProject({ targets, projectId: input.projectId });
  }
}
