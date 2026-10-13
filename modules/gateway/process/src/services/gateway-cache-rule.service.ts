import {
  createGatewayCacheRuleInputSchema,
  GatewayCacheRuleNotFoundError,
  type ArchiveGatewayCacheRuleInput,
  type CreateGatewayCacheRuleInput,
  type GatewayCacheRuleCursor,
  type GatewayCacheRuleResource,
  type UpdateGatewayCacheRuleInput,
} from "@langwatch/gateway-contract";

import type { GatewayCacheRuleRepository } from "../repositories/gateway-cache-rule.repository.ts";

/** Private cache-rule collaborator owned by the singular Gateway service. */
export class GatewayCacheRuleService {
  static create(repository: GatewayCacheRuleRepository): GatewayCacheRuleService {
    return new GatewayCacheRuleService(repository);
  }

  private constructor(private readonly repository: GatewayCacheRuleRepository) {}

  list(organizationId: string): Promise<GatewayCacheRuleResource[]> {
    return this.repository.findAll(organizationId);
  }

  listPage(input: {
    organizationId: string;
    limit: number;
    cursor: GatewayCacheRuleCursor | null;
  }): Promise<GatewayCacheRuleResource[]> {
    return this.repository.findPage(input);
  }

  findById(input: {
    id: string;
    organizationId: string;
  }): Promise<GatewayCacheRuleResource | null> {
    return this.repository.findById(input);
  }

  create(input: CreateGatewayCacheRuleInput): Promise<GatewayCacheRuleResource> {
    return this.repository.create(createGatewayCacheRuleInputSchema.parse(input));
  }

  async update(input: UpdateGatewayCacheRuleInput): Promise<GatewayCacheRuleResource> {
    const existing = await this.repository.findById({
      id: input.id,
      organizationId: input.organizationId,
    });
    if (!existing) {
      throw new GatewayCacheRuleNotFoundError();
    }

    return this.repository.update(input);
  }

  async archive(input: ArchiveGatewayCacheRuleInput): Promise<GatewayCacheRuleResource> {
    const existing = await this.repository.findById({
      id: input.id,
      organizationId: input.organizationId,
    });
    if (!existing) {
      throw new GatewayCacheRuleNotFoundError();
    }

    return this.repository.archive(input);
  }

  listEnabledForOrganization(organizationId: string): Promise<GatewayCacheRuleResource[]> {
    return this.repository.findEnabledForOrganization(organizationId);
  }
}
