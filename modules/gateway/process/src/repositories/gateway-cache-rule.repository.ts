import type {
  ArchiveGatewayCacheRuleInput,
  CreateGatewayCacheRuleInput,
  GatewayCacheRuleCursor,
  GatewayCacheRuleResource,
  UpdateGatewayCacheRuleInput,
} from "@langwatch/gateway-contract";

export abstract class GatewayCacheRuleRepository {
  abstract findAll(organizationId: string): Promise<GatewayCacheRuleResource[]>;
  abstract findPage(input: {
    organizationId: string;
    limit: number;
    cursor: GatewayCacheRuleCursor | null;
  }): Promise<GatewayCacheRuleResource[]>;
  abstract findById(input: {
    id: string;
    organizationId: string;
  }): Promise<GatewayCacheRuleResource | null>;
  abstract create(input: CreateGatewayCacheRuleInput): Promise<GatewayCacheRuleResource>;
  abstract update(input: UpdateGatewayCacheRuleInput): Promise<GatewayCacheRuleResource>;
  abstract archive(input: ArchiveGatewayCacheRuleInput): Promise<GatewayCacheRuleResource>;
  abstract findEnabledForOrganization(organizationId: string): Promise<GatewayCacheRuleResource[]>;
}
