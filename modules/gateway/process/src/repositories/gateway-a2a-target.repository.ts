import type {
  CreateGatewayA2aTargetInput,
  GatewayA2aTargetResource,
  UpdateGatewayA2aTargetInput,
} from "@langwatch/gateway-contract";

/** A2A targets of an organization; the live tier seals upstream headers at rest. */
export abstract class GatewayA2aTargetRepository {
  /** Live targets of the organization, org-wide and project-scoped alike. */
  abstract findAll(organizationId: string): Promise<GatewayA2aTargetResource[]>;
  abstract findById(input: {
    id: string;
    organizationId: string;
  }): Promise<GatewayA2aTargetResource | null>;
  abstract create(input: CreateGatewayA2aTargetInput): Promise<GatewayA2aTargetResource>;
  abstract update(input: UpdateGatewayA2aTargetInput): Promise<GatewayA2aTargetResource>;
  abstract archive(input: {
    id: string;
    organizationId: string;
  }): Promise<GatewayA2aTargetResource>;
}
