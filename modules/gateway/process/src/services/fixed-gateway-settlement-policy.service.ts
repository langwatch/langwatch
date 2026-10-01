import { type GatewaySettlementPolicy } from "../app/gateway.members.ts";

export class FixedGatewaySettlementPolicyService implements GatewaySettlementPolicy {
  private constructor(private readonly value: number) {}

  static create(graceMs: number): FixedGatewaySettlementPolicyService {
    if (!Number.isInteger(graceMs) || graceMs < 1_000) {
      throw new Error("Gateway settlement grace must be an integer of at least one second.");
    }

    return new FixedGatewaySettlementPolicyService(graceMs);
  }

  graceMs(): number {
    return this.value;
  }
}
