import type { GatewayProviderUsage, GatewayProviderUsageResult } from "@langwatch/gateway-contract";

import type { ModelProviderSpend } from "../model-provider.channels.ts";

/** The spend ledger's twin: every usage it is handed, in order, answered recorded. */
export class MemoryModelProviderSpendChannel implements ModelProviderSpend {
  readonly recorded: GatewayProviderUsage[] = [];

  static create(): MemoryModelProviderSpendChannel {
    return new MemoryModelProviderSpendChannel();
  }

  private constructor() {}

  recordProviderUsage(input: GatewayProviderUsage): Promise<GatewayProviderUsageResult> {
    this.recorded.push(input);
    return Promise.resolve({ status: "recorded" });
  }
}
