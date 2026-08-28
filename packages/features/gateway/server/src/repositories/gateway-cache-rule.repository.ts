import type {
  ArchiveGatewayCacheRuleInput,
  CreateGatewayCacheRuleInput,
  GatewayCacheRuleCursor,
  GatewayCacheRuleResource,
  UpdateGatewayCacheRuleInput,
} from "@langwatch/gateway-contract";

export abstract class GatewayCacheRuleRepository {
  abstract list(organizationId: string): Promise<GatewayCacheRuleResource[]>;
  abstract listPage(input: {
    organizationId: string;
    limit: number;
    cursor: GatewayCacheRuleCursor | null;
  }): Promise<GatewayCacheRuleResource[]>;
  abstract tryGet(id: string, organizationId: string): Promise<GatewayCacheRuleResource | null>;
  abstract create(input: CreateGatewayCacheRuleInput): Promise<GatewayCacheRuleResource>;
  abstract update(input: UpdateGatewayCacheRuleInput): Promise<GatewayCacheRuleResource>;
  abstract archive(input: ArchiveGatewayCacheRuleInput): Promise<GatewayCacheRuleResource>;
  abstract listEnabledForOrganization(organizationId: string): Promise<GatewayCacheRuleResource[]>;
}
