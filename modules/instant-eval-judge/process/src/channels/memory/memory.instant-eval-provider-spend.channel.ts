import type { GatewayProviderUsage, GatewayProviderUsageResult } from "@langwatch/gateway-contract";

import type { InstantEvalProviderSpend } from "../instant-eval-judge.channels.ts";

/** The spend ledger's twin: every usage it is handed, in order, answered recorded. */
export class MemoryInstantEvalProviderSpendChannel implements InstantEvalProviderSpend {
  readonly recorded: GatewayProviderUsage[] = [];

  static create(): MemoryInstantEvalProviderSpendChannel {
    return new MemoryInstantEvalProviderSpendChannel();
  }

  private constructor() {}

  recordProviderUsage(input: GatewayProviderUsage): Promise<GatewayProviderUsageResult> {
    this.recorded.push(input);
    return Promise.resolve({ status: "recorded" });
  }
}
