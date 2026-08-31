import {
  archiveGatewayCacheRuleInputSchema,
  createGatewayCacheRuleInputSchema,
  GatewayCacheRuleNotFoundError,
  updateGatewayCacheRuleInputSchema,
  type ArchiveGatewayCacheRuleInput,
  type CreateGatewayCacheRuleInput,
  type GatewayCacheRuleCursor,
  type GatewayCacheRuleResource,
  type UpdateGatewayCacheRuleInput,
} from "@langwatch/gateway-contract";
import { GatewayCacheRuleRepository } from "../repositories/gateway-cache-rule.repository";

/** Private cache-rule collaborator owned by the singular Gateway service. */
export class GatewayCacheRulePersistence {
  static create(repository: GatewayCacheRuleRepository): GatewayCacheRulePersistence {
    return new GatewayCacheRulePersistence(repository);
  }

  private constructor(private readonly repository: GatewayCacheRuleRepository) {}

  list(organizationId: string): Promise<GatewayCacheRuleResource[]> {
    return this.repository.list(organizationId);
  }

  listPage(input: {
    organizationId: string;
    limit: number;
    cursor: GatewayCacheRuleCursor | null;
  }): Promise<GatewayCacheRuleResource[]> {
    return this.repository.listPage(input);
  }

  tryGet(input: { id: string; organizationId: string }): Promise<GatewayCacheRuleResource | null> {
    return this.repository.tryGet(input);
  }

  create(input: CreateGatewayCacheRuleInput): Promise<GatewayCacheRuleResource> {
    return this.repository.create(createGatewayCacheRuleInputSchema.parse(input));
  }

  async update(input: UpdateGatewayCacheRuleInput): Promise<GatewayCacheRuleResource> {
    const parsed = updateGatewayCacheRuleInputSchema.parse(input);
    const existing = await this.repository.tryGet({
      id: parsed.id,
      organizationId: parsed.organizationId,
    });
    if (!existing) {
      throw new GatewayCacheRuleNotFoundError();
    }
    return this.repository.update(parsed);
  }

  async archive(input: ArchiveGatewayCacheRuleInput): Promise<GatewayCacheRuleResource> {
    const parsed = archiveGatewayCacheRuleInputSchema.parse(input);
    const existing = await this.repository.tryGet({
      id: parsed.id,
      organizationId: parsed.organizationId,
    });
    if (!existing) {
      throw new GatewayCacheRuleNotFoundError();
    }
    return this.repository.archive(parsed);
  }

  listEnabledForOrganization(organizationId: string): Promise<GatewayCacheRuleResource[]> {
    return this.repository.listEnabledForOrganization(organizationId);
  }
}
