import { GatewaySettlementPolicyPort } from "../ports/gateway-settlement-policy.port";

export class FixedGatewaySettlementPolicyAdapter extends GatewaySettlementPolicyPort {
  private constructor(private readonly value: number) {
    super();
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
