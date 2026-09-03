import type {
  ArchiveGatewayGuardrailInput,
  CreateGatewayGuardrailInput,
  GatewayGuardrailResource,
  GatewayGuardrailBundleEntry,
  UpdateGatewayGuardrailInput,
} from "@langwatch/gateway-contract";

export abstract class GatewayGuardrailRepository {
  abstract list(projectId: string): Promise<GatewayGuardrailResource[]>;
  abstract listBundleEntries(projectId: string): Promise<GatewayGuardrailBundleEntry[]>;
  abstract tryGet(input: {
    id: string;
    projectId: string;
  }): Promise<GatewayGuardrailResource | null>;
  abstract create(input: CreateGatewayGuardrailInput): Promise<GatewayGuardrailResource>;
  abstract update(input: UpdateGatewayGuardrailInput): Promise<GatewayGuardrailResource>;
  abstract archive(input: ArchiveGatewayGuardrailInput): Promise<void>;
}
