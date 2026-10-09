import {
  type BackfillJsonObject,
  type BackfillJsonValue,
  GatewayVirtualKeyConfigBackfillRepository,
  type MintGuardrailInput,
  type MintRoutingPolicyInput,
  type VirtualKeyRow,
} from "../gateway-virtual-key-config-backfill.repository.ts";
import type { MemoryGatewayStore } from "./memory.gateway.store.ts";

/**
 * The key rows the store holds, walked and rewritten as the backfill does.
 * Minted policies and guardrails are kept on the twin for a test to read back.
 */
export class MemoryGatewayVirtualKeyConfigBackfillRepository extends GatewayVirtualKeyConfigBackfillRepository {
  static create(store: MemoryGatewayStore): MemoryGatewayVirtualKeyConfigBackfillRepository {
    return new MemoryGatewayVirtualKeyConfigBackfillRepository(store);
  }

  readonly mintedRoutingPolicies: MintRoutingPolicyInput[] = [];
  readonly mintedGuardrails: (MintGuardrailInput & { id: string })[] = [];

  private constructor(private readonly store: MemoryGatewayStore) {
    super();
  }

  async findVirtualKeys({ organizationId }: { organizationId: string }): Promise<VirtualKeyRow[]> {
    return [...this.store.virtualKeys.values()]
      .filter((key) => key.organizationId === organizationId)
      .toSorted(
        (left, right) => left.createdAt.epochMilliseconds - right.createdAt.epochMilliseconds,
      )
      .map((key) => ({
        id: key.id,
        name: key.name,
        organizationId: key.organizationId,
        routingPolicyId: key.routingPolicyId,
        config: key.config as BackfillJsonValue | undefined,
        scopes: key.scopes.map((scope) => ({ scopeType: scope.scopeType, scopeId: scope.scopeId })),
      }));
  }

  async mintRoutingPolicy(input: MintRoutingPolicyInput): Promise<string> {
    this.mintedRoutingPolicies.push(input);
    return input.id;
  }

  async mintGuardrail(input: MintGuardrailInput): Promise<string> {
    const id = this.store.newId("gr");
    this.mintedGuardrails.push({ ...input, id });
    return id;
  }

  async updateVirtualKeyConfig({
    id,
    config,
    routingPolicyId,
  }: {
    id: string;
    config: BackfillJsonObject;
    routingPolicyId: string | null;
  }): Promise<void> {
    const key = this.store.virtualKeys.get(id);
    if (!key) return;
    this.store.virtualKeys.set(id, { ...key, config, routingPolicyId });
  }
}
