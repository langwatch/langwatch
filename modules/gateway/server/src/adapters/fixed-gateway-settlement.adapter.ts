import { GatewaySettlementPolicy } from "../app/gateway.infrastructure.ts";

export class FixedGatewaySettlementPolicyAdapter implements GatewaySettlementPolicy {
  private constructor(private readonly value: number) {
  }

  static create(graceMs: number): FixedGatewaySettlementPolicyAdapter {
    if (!Number.isInteger(graceMs) || graceMs < 1_000) {
      throw new Error("Gateway settlement grace must be an integer of at least one second.");
    }

    return new FixedGatewaySettlementPolicyAdapter(graceMs);
  }

  graceMs(): number {
    return this.value;
  }
}
