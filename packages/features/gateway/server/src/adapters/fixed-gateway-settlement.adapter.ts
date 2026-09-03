import { GatewaySettlementPolicyPort } from "../ports/gateway-settlement-policy.port";

export class FixedGatewaySettlementPolicy extends GatewaySettlementPolicyPort {
  private constructor(private readonly value: number) {
    super();
  }

  static create(graceMs: number): FixedGatewaySettlementPolicy {
    if (!Number.isInteger(graceMs) || graceMs < 1_000) {
      throw new Error("Gateway settlement grace must be an integer of at least one second.");
    }

    return new FixedGatewaySettlementPolicy(graceMs);
  }

  graceMs(): number {
    return this.value;
  }
}
