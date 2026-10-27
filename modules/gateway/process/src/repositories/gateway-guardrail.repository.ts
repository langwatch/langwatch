import type {
  ArchiveGatewayGuardrailInput,
  GatewayGuardrailDirection,
  CreateGatewayGuardrailInput,
  GatewayGuardrailResource,
  GatewayGuardrailBundleEntry,
  UpdateGatewayGuardrailInput,
} from "@langwatch/gateway-contract";

export abstract class GatewayGuardrailRepository {
  abstract findAll(projectId: string): Promise<GatewayGuardrailResource[]>;
  abstract findBundleEntries(projectId: string): Promise<GatewayGuardrailBundleEntry[]>;
  abstract findById(input: {
    id: string;
    projectId: string;
  }): Promise<GatewayGuardrailResource | null>;
  abstract create(input: CreateGatewayGuardrailInput): Promise<GatewayGuardrailResource>;
  abstract update(input: UpdateGatewayGuardrailInput): Promise<GatewayGuardrailResource>;
  abstract archive(input: ArchiveGatewayGuardrailInput): Promise<void>;
  /**
   * The live guardrails a data-plane check may run: named by the caller,
   * pointing the stated way, and scoped to the project as well as the id so
   * one project's virtual key cannot name another project's guardrail.
   */
  abstract findRunnableForCheck(input: {
    projectId: string;
    ids: string[];
    direction: GatewayGuardrailDirection;
  }): Promise<GatewayGuardrailCheckRow[]>;
}

/** What running one guardrail needs off its row. */
export type GatewayGuardrailCheckRow = {
  id: string;
  name: string;
  evaluatorId: string;
  failureMode: string;
};
