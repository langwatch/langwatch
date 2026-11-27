import type { GatewayProviderUsage, GatewayProviderUsageResult } from "@langwatch/gateway-contract";

import type { EvaluationProviderSpend } from "../evaluation.channels.ts";

/** The spend ledger's twin: every usage it is handed, in order, answered recorded. */
export class MemoryProviderSpendChannel implements EvaluationProviderSpend {
  readonly recorded: GatewayProviderUsage[] = [];

  static create(): MemoryProviderSpendChannel {
    return new MemoryProviderSpendChannel();
  }

  private constructor() {}

  recordProviderUsage(input: GatewayProviderUsage): Promise<GatewayProviderUsageResult> {
    this.recorded.push(input);
    return Promise.resolve({ status: "recorded" });
  }
}
